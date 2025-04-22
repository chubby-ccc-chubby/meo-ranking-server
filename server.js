// server.js (書き込み行固定・最終版)
require("dotenv").config();
const express = require("express");
const puppeteer = require("puppeteer-core");
const { google } = require("googleapis");
const fs = require("fs");
const cors = require("cors");
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- 環境変数・認証情報 ---
const spreadsheetId = process.env.SPREADSHEET_ID;
const credsPath = '/etc/secrets/creds.json'; // Render Secret File のパス
let credentials;
try {
  if (fs.existsSync(credsPath)) {
    credentials = JSON.parse(fs.readFileSync(credsPath));
    console.log("Successfully loaded credentials from Secret File.");
  } else {
    console.error(`Error: Credentials file not found at ${credsPath}. Make sure the Secret File is configured correctly.`);
    throw new Error(`Credentials file not found at ${credsPath}`);
  }
} catch (error) {
  console.error("Error reading or parsing credentials:", error);
  process.exit(1);
}

// --- Google API Client ---
async function authorize() {
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return await auth.getClient();
}

// --- ヘルスチェック・デバッグエンドポイント ---
app.get('/health', (req, res) => {
  const execPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  let chromeExists = false;
  let checkError = null;
  try {
      chromeExists = execPath ? fs.existsSync(execPath) : false;
  } catch (e) { checkError = e.toString(); }
  const status = { status: 'OK', timestamp: new Date().toISOString(), puppeteer: { executablePath: execPath || 'Not Set', exists: chromeExists, checkError: checkError }, node: process.version, memory: process.memoryUsage() };
  res.status(200).json(status);
});
app.get('/debug', (req, res) => {
    let debugInfo = { importantEnv: { NODE_ENV: process.env.NODE_ENV, PORT: process.env.PORT, PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH, SPREADSHEET_ID: process.env.SPREADSHEET_ID ? 'Set' : 'Not Set' }, cwd: process.cwd(), dir: __dirname, platform: process.platform, arch: process.arch, filesInCwd: [], chromeDirContents: [], chromeDirError: null, };
    try { debugInfo.filesInCwd = fs.readdirSync(process.cwd()); } catch (error) { debugInfo.filesInCwd = `Error reading cwd: ${error.toString()}`; }
    const execPath = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (execPath) { try { const parentDir = path.dirname(execPath); if (fs.existsSync(parentDir)) { debugInfo.chromeDirContents = fs.readdirSync(parentDir); } else { debugInfo.chromeDirError = `Directory ${parentDir} does not exist.`; } } catch (error) { debugInfo.chromeDirError = error.toString(); } }
    res.status(200).json(debugInfo);
});


// --- 補助関数 ---
function normalize(str) {
  if (str == null) return "";
  return decodeURIComponent(String(str)).replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
}

function colToLetter(column) {
  let temp, letter = '';
  while (column > 0) {
    temp = (column - 1) % 26;
    letter = String.fromCharCode(65 + temp) + letter;
    column = (column - temp - 1) / 26;
  }
  return letter;
}

// --- スプレッドシート操作関数 ---
async function getKeywords(sheetName, auth) {
    const sheets = google.sheets({ version: "v4", auth });
    const ranges = [`${sheetName}!R1:W1`, `${sheetName}!AA1:AO1`];
    console.log(`Workspaceing keywords from ranges: ${ranges.join(', ')} for sheet: ${sheetName}`);
    try {
      const res = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges });
      if (!res.data.valueRanges) { console.log("No valueRanges found."); return []; }
      const keywords = res.data.valueRanges.flatMap(range => (range.values?.[0] || []).filter(v => v && String(v).trim() !== ""));
      console.log(`Found keywords: ${keywords.join(', ')}`);
      return keywords;
    } catch (error) {
      console.error(`Error fetching keywords for sheet ${sheetName}:`, error.response ? error.response.data : error.message);
      throw error;
    }
}

// ▼▼▼ 次に書き込むべき行番号を取得するヘルパー関数 ▼▼▼
async function getTargetRowForNextWrite(sheetName, auth) {
  const sheets = google.sheets({ version: 'v4', auth });
  // MEOランクを書き込む可能性のある列を含む範囲を確認 (R列から右のデータで判断)
  const rangeToCheck = `${sheetName}!R:AQ`; // チェック範囲をMEO列に絞る
  console.log(`[getTargetRow] Checking range ${rangeToCheck} to find last row with rank data.`);
  try {
    const getRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: rangeToCheck,
    });
    const rows = getRes.data.values;
    let lastRowWithRankData = 0;
    if (rows) {
      // データ(空文字やnull以外)がある最後の行を探す
      for (let i = rows.length - 1; i >= 0; i--) {
        // 行が存在し、かつその行のいずれかのセルに値があるかチェック
        if (rows[i] && rows[i].some(cell => cell !== null && cell !== undefined && cell !== '')) {
          lastRowWithRankData = i + 1; // 1始まりの行番号
          break;
        }
      }
    }
    // データがある最終行の次の行をターゲットとする
    const targetRow = lastRowWithRankData + 1;
    // ヘッダー行(1行目)なども考慮し、最低でも2行目から書き込む等の調整が必要ならここで行う
    // 例: const targetRow = Math.max(2, lastRowWithRankData + 1);
    console.log(`[getTargetRow] Determined target row for this run: ${targetRow} (based on last data in ${rangeToCheck})`);
    return targetRow;
  } catch (error) {
    console.error(`[getTargetRow] Error finding target row for sheet ${sheetName}:`, error.response ? error.response.data : error.message);
    console.warn("[getTargetRow] Falling back to target row 2 due to error.");
    return 2; // エラー時は安全策として2行目などを返す（要検討）
  }
}
// ▲▲▲ 次に書き込むべき行番号を取得するヘルパー関数 ▲▲▲


// ▼▼▼ writeRankingToSheet: targetRow を引数で受け取るように変更 ▼▼▼
async function writeRankingToSheet(sheetName, columnIndex, rank, targetRow, auth) { // auth も引数で受け取る
  try {
    const sheets = google.sheets({ version: 'v4', auth }); // 渡された auth を使う

    const targetColIndex = columnIndex < 6 ? 18 + columnIndex : 27 + (columnIndex - 6);
    const targetColLetter = colToLetter(targetColIndex);
    const targetCell = `${sheetName}!${targetColLetter}${targetRow}`; // 引数の targetRow を使う

    console.log(`[NodeWrite] Writing rank "${rank}" to ${targetCell} (Keyword index: ${columnIndex}, TargetRow: ${targetRow})`);

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: targetCell,
      valueInputOption: "USER_ENTERED", // 文字列("over")もそのまま書き込む
      resource: { values: [[rank]] }, // rank が数値でも文字列("over")でもそのまま渡す
    });
    console.log(`[NodeWrite] Successfully wrote rank to ${targetCell}`);
  } catch (error) {
    console.error(`[NodeWrite] Error writing rank for sheet ${sheetName}, keyword index ${columnIndex}, target row ${targetRow}:`, error.response ? error.response.data : error.message);
  }
}
// ▲▲▲ writeRankingToSheet 修正 ▲▲▲


// --- Puppeteer 順位取得関数 (スクロール版、戻り値"over") ---
async function getRanking(keyword, storeName) {
  console.log(`Starting getRanking (Attempt Top 100) for keyword: "${keyword}", storeName: "${storeName}"`);
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  const options = {
      headless: true,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-accelerated-2d-canvas','--no-first-run','--no-zygote','--disable-gpu'],
      executablePath: executablePath
  };
  if (!options.executablePath) { return "取得失敗(実行パス未設定)"; }
  console.log("!!! Launching Puppeteer with options:", JSON.stringify(options, null, 2));

  let browser;
  try {
    browser = await puppeteer.launch(options);
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja-JP,ja;q=0.9' });

    console.log(`Navigating to Google Maps for keyword: "${keyword}"`);
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(keyword)}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 100000 });

    try {
        const consentSelectors = ['button[aria-label*="Accept"]', 'button[aria-label*="同意"]', 'form[action*="consent"] button'];
        let consentButtonClicked = false;
        for (const selector of consentSelectors) {
            try {
                const consentButton = await page.waitForSelector(selector, { visible: true, timeout: 3000 });
                if (consentButton) {
                    console.log(`Attempting to click consent button with selector: ${selector}`);
                    await consentButton.click(); await new Promise(r => setTimeout(r, 3500));
                    console.log("Consent button likely clicked."); consentButtonClicked = true; break;
                }
            } catch (e) { }
        }
        if (!consentButtonClicked) { console.log("No common consent buttons found or clicked."); }
    } catch (e) { console.error("Error during consent button handling:", e); }

    console.log(`Waiting for initial search results for keyword: "${keyword}"`);
    const resultSelector = 'div.Nv2PK';
    try {
      await page.waitForSelector(resultSelector, { timeout: 30000 });
    } catch (waitError) {
      console.error(`Timeout waiting for initial search results selector (${resultSelector}) for keyword: "${keyword}".`);
      const pageContentForDebug = await page.content();
      console.error("Page content on selector timeout:", pageContentForDebug.substring(0, 1000));
      if (browser) await browser.close();
      return "取得失敗(セレクタ)";
    }

    console.log(`Scrolling until end of results for keyword: "${keyword}"...`);
    let items = await page.$$(resultSelector);
    let previousHeight = 0;
    let scrollAttempts = 0;
    const maxScrollAttempts = 100;

    while (true) {
      scrollAttempts++;
      console.log(`Scroll attempt ${scrollAttempts}. Current items: ${items.length}`);

      const feedHeight = await page.evaluate(() => {
        const feed = document.querySelector('[role="feed"]');
        return feed ? feed.scrollHeight : 0;
      });

      await page.evaluate(() => {
        const feed = document.querySelector('[role="feed"]');
        if (feed) feed.scrollBy(0, 1000);
      });

      await new Promise(resolve => setTimeout(resolve, 1500));

      const newItems = await page.$$(resultSelector);
      const newHeight = await page.evaluate(() => {
        const feed = document.querySelector('[role="feed"]');
        return feed ? feed.scrollHeight : 0;
      });

      if (newItems.length === items.length && newHeight === feedHeight) {
        console.log("Reached the end of scrollable list.");
        break;
      }

      items = newItems;
      if (scrollAttempts >= maxScrollAttempts) {
        console.log("Max scroll attempts reached.");
        break;
      }
    }

    console.log(`Finished feed scroll. Found ${items.length} items.`);

    let rank = "over";
    const limit = items.length;
    console.log(`Checking top ${limit} items...`);

    for (let i = 0; i < limit; i++) {
      const item = items[i];
      let storeNameOnMap = '';
      try {
        storeNameOnMap = await item.evaluate(el => {
            const linkElement = el.querySelector('a.hfpxzc');
            return linkElement ? linkElement.getAttribute('aria-label') : null;
        });

        if (storeNameOnMap) {
            storeNameOnMap = storeNameOnMap.trim();
            console.log(`Checking item ${i + 1}: "${storeNameOnMap}" against target: "${storeName}"`);
            if (normalize(storeNameOnMap).includes(normalize(storeName))) {
              rank = i + 1;
              console.log(`Rank found: ${rank} for keyword: "${keyword}"`);
              break;
            }
        } else {
             console.log(`Could not extract store name (aria-label from a.hfpxzc) from item ${i + 1}`);
        }
      } catch (evalError) {
        console.error(`Error processing item ${i + 1} for keyword: "${keyword}"`, evalError);
      }
    }

    if (rank === "over") {
        console.log(`Store "${storeName}" not found in the top ${limit} results for keyword: "${keyword}"`);
    }

    await browser.close();
    console.log(`Finished getRanking (Attempt Top 100) for keyword: "${keyword}". Rank: ${rank}`);
    return rank;

  } catch (error) {
    console.error(`Error in getRanking for keyword "${keyword}":`, error);
    if (browser) { await browser.close(); }
    if (error.message.includes('executablePath')) { return "取得失敗(実行パス)"; }
    else if (error.message.includes('selector')) { return "取得失敗(セレクタ)"; }
    else if (error.message.includes('Navigation timeout') || error.message.includes('goto')) { return "取得失敗(ページ読込)"; }
    else if (error.name === 'TimeoutError') { return "取得失敗(操作タイムアウト)"; }
    return "取得失敗(不明なエラー)";
  }
}

// --- メインのエンドポイント (/meo-ranking) ---
app.post("/meo-ranking", async (req, res) => {
  const sheetName = req.body.sheetName;
  console.log(`Received async request for sheet: ${sheetName}`);
  if (!sheetName) {
    console.error("Sheet name not provided in request body.");
    return res.status(400).send("シート名が指定されていません");
  }

  // すぐに応答を返す
  res.status(200).send(`順位取得リクエスト受付: ${sheetName}. バックグラウンド処理を開始します。`);
  console.log(`Sent initial response for sheet: ${sheetName}. Starting background processing...`);

  // バックグラウンド処理
  (async () => {
    let auth;
    try {
      auth = await authorize(); // 最初に認証
      const keywords = await getKeywords(sheetName, auth);

      if (keywords.length === 0) {
          console.log(`No keywords found for sheet: ${sheetName}. Background processing finished.`);
          return;
      }

      // ★★★ ループの前に書き込み先の行番号を1回だけ決定 ★★★
      const targetRowForThisRun = await getTargetRowForNextWrite(sheetName, auth);

      console.log(`Processing ${keywords.length} keywords in background for sheet: ${sheetName}, Target Row: ${targetRowForThisRun}`);
      for (let i = 0; i < keywords.length; i++) {
        const keyword = keywords[i];
        console.log(`--- Background: Processing keyword ${i+1}/${keywords.length}: "${keyword}" ---`);
        const rank = await getRanking(keyword, sheetName);
        // ★★★ 決定した行番号を渡して書き込み ★★★
        await writeRankingToSheet(sheetName, i, rank, targetRowForThisRun, auth);
      }
      console.log(`✅ Finished background processing all keywords for sheet: ${sheetName}`);
    } catch (e) {
      console.error(`Unhandled error during background processing for sheet ${sheetName}:`, e.message, e.stack);
    }
  })();
});


// --- サーバー起動 ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ MEOサーバー稼働中： Port ${PORT}`);
});

// --- プロセスイベントハンドラ ---
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('SIGTERM', () => {
  console.info('SIGTERM signal received. Closing server.');
  process.exit(0);
});
