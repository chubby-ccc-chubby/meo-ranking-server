// server.js (最終セレクタ修正・非同期・Node.js書き込み版)
require("dotenv").config(); // .envは使用しないが念のため残す or 削除
const express = require("express");
const puppeteer = require("puppeteer-core"); // puppeteer-core を使用
const { google } = require("googleapis");
const fs = require("fs");
const cors = require("cors");
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- 環境変数・認証情報 ---
const spreadsheetId = process.env.SPREADSHEET_ID; // Render.com 環境変数から取得
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
  let debugInfo = {
    importantEnv: { NODE_ENV: process.env.NODE_ENV, PORT: process.env.PORT, PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH, SPREADSHEET_ID: process.env.SPREADSHEET_ID ? 'Set' : 'Not Set' },
    cwd: process.cwd(), dir: __dirname, platform: process.platform, arch: process.arch,
    filesInCwd: [], chromeDirContents: [], chromeDirError: null,
  };
  try { debugInfo.filesInCwd = fs.readdirSync(process.cwd()); } catch (error) { debugInfo.filesInCwd = `Error reading cwd: ${error.toString()}`; }
  const execPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (execPath) {
    try {
      const parentDir = path.dirname(execPath);
      if (fs.existsSync(parentDir)) { debugInfo.chromeDirContents = fs.readdirSync(parentDir); }
      else { debugInfo.chromeDirError = `Directory ${parentDir} does not exist.`; }
    } catch (error) { debugInfo.chromeDirError = error.toString(); }
  }
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
    const ranges = [`${sheetName}!R1:W1`, `${sheetName}!AA1:AO1`]; // キーワード範囲
    console.log(`Workspaceing keywords from ranges: ${ranges.join(', ')} for sheet: ${sheetName}`);
    try {
      const res = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges });
      if (!res.data.valueRanges) { console.log("No valueRanges found."); return []; }
      const keywords = res.data.valueRanges.flatMap(range => (range.values?.[0] || []).filter(v => v && String(v).trim() !== ""));
      console.log(`Found keywords: ${keywords.join(', ')}`);
      return keywords;
    } catch (error) {
      console.error(`Error fetching keywords for sheet ${sheetName}:`, error.response ? error.response.data : error.message);
      throw error; // エラーを上に伝播させる
    }
}

async function writeRankingToSheet(sheetName, columnIndex, rank) {
  try {
    const auth = await authorize();
    const sheets = google.sheets({ version: 'v4', auth });
    const getRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!A:A`, majorDimension: 'COLUMNS' });
    const lastRowA = getRes.data.values?.[0]?.length || 0;
    const targetRow = lastRowA + 1;
    const targetColIndex = columnIndex < 6 ? 18 + columnIndex : 27 + (columnIndex - 6);
    const targetColLetter = colToLetter(targetColIndex);
    const targetCell = `${sheetName}!${targetColLetter}${targetRow}`;
    console.log(`[NodeWrite] Writing rank "${rank}" to ${targetCell} (Keyword index: ${columnIndex})`);
    await sheets.spreadsheets.values.update({
      spreadsheetId, range: targetCell, valueInputOption: "USER_ENTERED",
      resource: { values: [[rank === 0 ? 0 : (rank || "")]] }, // 0は数値、他は文字列か空文字
    });
    console.log(`[NodeWrite] Successfully wrote rank to ${targetCell}`);
  } catch (error) {
    console.error(`[NodeWrite] Error writing rank for sheet ${sheetName}, keyword index ${columnIndex}:`, error.response ? error.response.data : error.message);
  }
}

// --- Puppeteer 順位取得関数 (セレクタ修正版) ---
// server.js 内の getRanking 関数を以下に置き換え

async function getRanking(keyword, storeName) {
  console.log(`Starting getRanking (Top 20) for keyword: "${keyword}", storeName: "${storeName}"`);
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  const options = {
      headless: true,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-accelerated-2d-canvas','--no-first-run','--no-zygote','--disable-gpu'],
      executablePath: executablePath
  };
  if (!options.executablePath) {
      console.error("!!! CRITICAL ERROR: PUPPETEER_EXECUTABLE_PATH is not set!");
      return "取得失敗(実行パス未設定)";
  }
  console.log("!!! Launching Puppeteer with options:", JSON.stringify(options, null, 2));

  let browser;
  try {
    browser = await puppeteer.launch(options);
    const page = await browser.newPage();
    // ユーザーエージェントはPC Chromeに偽装
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36');
    // 日本語設定を試みる
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja-JP,ja;q=0.9' });

    console.log(`Navigating to Google Maps for keyword: "${keyword}"`);
    // ▼▼▼ 正しいGoogleマップ検索URLに修正 ▼▼▼
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(keyword)}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 }); // 60秒タイムアウト

    // ▼▼▼ Cookie同意ボタンなどをクリックする試み (初回アクセス時など) ▼▼▼
    try {
        // 一般的な同意ボタンのセレクタやテキスト (複数試す)
        const consentSelectors = [
            'button[aria-label*="Accept"]', // Accept all
            'button[aria-label*="同意"]',    // 同意する
            'form[action*="consent"] button', // フォーム内のボタン
            // 必要に応じて他のセレクタを追加
        ];
        let consentButtonClicked = false;
        for (const selector of consentSelectors) {
            try {
                const consentButton = await page.waitForSelector(selector, { visible: true, timeout: 3000 }); // 短いタイムアウトで確認
                if (consentButton) {
                    console.log(`Attempting to click consent button with selector: ${selector}`);
                    await consentButton.click();
                    await page.waitForTimeout(1500); // クリック後の待機
                    console.log("Consent button likely clicked.");
                    consentButtonClicked = true;
                    break; // どれか一つクリックできたらループを抜ける
                }
            } catch (e) {
                // セレクタが見つからなくてもエラーとしない
            }
        }
        if (!consentButtonClicked) {
            console.log("No common consent buttons found or clicked.");
        }
    } catch (e) {
        console.error("Error during consent button handling:", e);
    }
    // ▲▲▲ 同意ボタン処理ここまで ▲▲▲


    console.log(`Waiting for search results (Top 20) for keyword: "${keyword}"`);
    // セレクタは前回特定したものを引き続き使用（ページが正しく表示されれば見つかるはず）
    const resultSelector = 'div.Nv2PK';

    try {
      await page.waitForSelector(resultSelector, { timeout: 30000 }); // 30秒待機
    } catch (waitError) {
      console.error(`Timeout or error waiting for search results selector (${resultSelector}) for keyword: "${keyword}".`);
      const pageContentForDebug = await page.content();
      console.error("Page content on selector timeout:", pageContentForDebug.substring(0, 1000));
      await browser.close();
      return "取得失敗(セレクタ)";
    }

    // (スクロール処理は削除済み)

    console.log(`Extracting top 20 search results for keyword: "${keyword}"`);
    const items = await page.$$(resultSelector);
    console.log(`Found ${items.length} items initially for keyword: "${keyword}"`);

    let rank = 0;
    const limit = Math.min(items.length, 20);
    console.log(`Checking top ${limit} items...`);

    for (let i = 0; i < limit; i++) {
      const item = items[i];
      let storeNameOnMap = '';
      try {
        // 店舗名取得 (aria-label)
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

    if (rank === 0) {
      console.log(`Store "${storeName}" not found in the top ${limit} results for keyword: "${keyword}"`);
    }

    await browser.close();
    console.log(`Finished getRanking (Top 20) for keyword: "${keyword}". Rank: ${rank}`);
    return rank; // 順位 (1-20) または 0 を返す

  } catch (error) {
    console.error(`Error in getRanking for keyword "${keyword}":`, error);
    if (browser) { await browser.close(); }
    if (error.message.includes('executablePath')) { return "取得失敗(実行パス)"; }
    else if (error.message.includes('selector')) { return "取得失敗(セレクタ)"; }
    else if (error.message.includes('Navigation timeout') || error.message.includes('goto')) { return "取得失敗(ページ読込)"; }
    return "取得失敗(不明なエラー)";
  }
}

// --- server.js の残りの部分は変更ありません ---
// (authorize, getKeywords, writeRankingToSheet, colToLetter, /meo-ranking endpoint, app.listen, etc.)

// --- メインのエンドポイント (/meo-ranking) ---
app.post("/meo-ranking", async (req, res) => {
  const sheetName = req.body.sheetName;
  console.log(`Received async request for sheet: ${sheetName}`);
  if (!sheetName) {
    console.error("Sheet name not provided in request body.");
    return res.status(400).send("シート名が指定されていません");
  }

  // ★★★ すぐに応答を返す ★★★
  res.status(200).send(`順位取得リクエスト受付: ${sheetName}. バックグラウンド処理を開始します。`);
  console.log(`Sent initial response for sheet: ${sheetName}. Starting background processing...`);

  // ▼▼▼ バックグラウンドで非同期処理を実行 ▼▼▼
  (async () => {
    try {
      const auth = await authorize();
      const keywords = await getKeywords(sheetName, auth);

      if (keywords.length === 0) {
          console.log(`No keywords found for sheet: ${sheetName}. Background processing finished.`);
          return;
      }

      console.log(`Processing ${keywords.length} keywords in background for sheet: ${sheetName}`);
      for (let i = 0; i < keywords.length; i++) {
        const keyword = keywords[i];
        console.log(`--- Background: Processing keyword ${i+1}/${keywords.length}: "${keyword}" ---`);
        const rank = await getRanking(keyword, sheetName);
        await writeRankingToSheet(sheetName, i, rank); // Node.jsから書き込み
        // (任意) 負荷軽減のため待機
        // await new Promise(resolve => setTimeout(resolve, 1000));
      }
      console.log(`✅ Finished background processing all keywords for sheet: ${sheetName}`);
    } catch (e) {
      console.error(`Unhandled error during background processing for sheet ${sheetName}:`, e.response ? e.response.data : e.message, e.stack);
    }
  })(); // 非同期関数を即時実行
});


// --- サーバー起動 ---
const PORT = process.env.PORT || 3000; // Renderが設定するPORTを使う
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