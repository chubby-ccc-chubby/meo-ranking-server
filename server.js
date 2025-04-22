// server.js (ヘルスチェック、デバッグエンドポイント、デバッグログ追加版)
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser"); // body-parser は非推奨なので express.json() への移行検討
const puppeteer = require("puppeteer-core"); // puppeteer-core に変更済み
const { google } = require("googleapis");
const fs = require("fs"); // require('fs') を先頭に移動（既に存在）
const cors = require("cors");
const path = require('path'); // path モジュールを追加

const app = express(); // ★ app の定義を最初に行う

app.use(cors());
// bodyParser.json() の代わりに express.json() を使用 (Express v4.16.0+)
app.use(express.json());
// bodyParser.urlencoded({ extended: true }) の代わりに express.urlencoded({ extended: true }) を使用
app.use(express.urlencoded({ extended: true }));


// SPREADSHEET_ID は Render.com の環境変数で設定
const spreadsheetId = process.env.SPREADSHEET_ID;
// creds.json のパスを指定 (プロジェクトルートにある想定)
const credsPath = '/etc/secrets/creds.json'; // Render Secret File のパス
let credentials;
try {
  if (fs.existsSync(credsPath)) {
    credentials = JSON.parse(fs.readFileSync(credsPath));
    console.log("Successfully loaded credentials from Secret File."); // 成功ログ追加
  } else {
    console.error(`Error: Credentials file not found at ${credsPath}. Make sure the Secret File is configured correctly.`);
    throw new Error(`Credentials file not found at ${credsPath}`);
  }
} catch (error) {
  console.error("Error reading or parsing credentials:", error);
  process.exit(1);
}

// ▼▼▼ ヘルスチェックエンドポイントを追加 ▼▼▼
app.get('/health', (req, res) => {
  const execPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  let chromeExists = false;
  let checkError = null;
  try {
      // executablePath が設定されているか、かつそのパスにファイルが存在するか
      chromeExists = execPath ? fs.existsSync(execPath) : false;
  } catch (e) {
      checkError = e.toString();
  }

  const status = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    puppeteer: {
      executablePath: execPath || 'Not Set',
      exists: chromeExists,
      checkError: checkError
    },
    node: process.version,
    memory: process.memoryUsage(),
  };
  res.status(200).json(status);
});

// ▼▼▼ デバッグ/環境情報エンドポイントを追加 ▼▼▼
app.get('/debug', (req, res) => {
  let debugInfo = {
    env: {}, // セキュリティのため、全ての環境変数を返すのは避ける
    importantEnv: { // 重要な環境変数のみ抜粋
        NODE_ENV: process.env.NODE_ENV,
        PORT: process.env.PORT,
        PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH,
        SPREADSHEET_ID: process.env.SPREADSHEET_ID ? 'Set' : 'Not Set', // ID自体は表示しない
    },
    cwd: process.cwd(),
    dir: __dirname,
    platform: process.platform,
    arch: process.arch,
    filesInCwd: [],
    chromeDirContents: [],
    chromeDirError: null,
  };

  try {
    debugInfo.filesInCwd = fs.readdirSync(process.cwd());
  } catch (error) {
      debugInfo.filesInCwd = `Error reading cwd: ${error.toString()}`;
  }

  // PUPPETEER_EXECUTABLE_PATHが存在する場合、そのディレクトリを確認
  const execPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (execPath) {
    try {
      const parentDir = path.dirname(execPath); // path.dirname を使う方が確実
      if (fs.existsSync(parentDir)) {
        debugInfo.chromeDirContents = fs.readdirSync(parentDir);
      } else {
        debugInfo.chromeDirError = `Directory ${parentDir} does not exist.`;
      }
    } catch (error) {
      debugInfo.chromeDirError = error.toString();
    }
  }

  res.status(200).json(debugInfo);
});
// ▲▲▲ ここまで追加 ▲▲▲


function normalize(str) {
  if (str == null) return "";
  return decodeURIComponent(String(str)).replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
}

async function authorize() {
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return await auth.getClient();
}

async function getKeywords(sheetName, auth) {
    const sheets = google.sheets({ version: "v4", auth });
    const ranges = [`${sheetName}!R1:W1`, `${sheetName}!AA1:AO1`];
    console.log(`Workspaceing keywords from ranges: ${ranges.join(', ')} for sheet: ${sheetName}`);
    try {
      const res = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges,
      });
      if (!res.data.valueRanges) {
        console.log("No valueRanges found in response for keywords.");
        return [];
      }
      const keywords = res.data.valueRanges.flatMap((range) => {
        return (range.values && Array.isArray(range.values) && range.values.length > 0 && Array.isArray(range.values[0]))
               ? range.values[0].filter((v) => v && String(v).trim() !== "")
               : [];
      });
      console.log(`Found keywords: ${keywords.join(', ')}`);
      return keywords;
    } catch (error) {
      console.error(`Error fetching keywords for sheet ${sheetName}:`, error);
      throw error;
    }
}

async function writeRanking(sheetName, columnIndex, rank, auth) {
  const sheets = google.sheets({ version: "v4", auth });
  try {
    const getRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:A`,
      majorDimension: 'COLUMNS'
    });
    const lastRowA = getRes.data.values && getRes.data.values[0] ? getRes.data.values[0].length : 0;
    const targetRow = lastRowA + 1;
    const targetColIndex = columnIndex < 6
                          ? 18 + columnIndex
                          : 27 + (columnIndex - 6);
    const targetColLetter = colToLetter(targetColIndex);
    const targetCell = `${sheetName}!${targetColLetter}${targetRow}`;
    console.log(`Writing rank ${rank} to ${targetCell} (Keyword index: ${columnIndex})`);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: targetCell,
      valueInputOption: "RAW",
      resource: { values: [[rank]] },
    });
  } catch (error) {
      console.error(`Error writing rank for sheet ${sheetName}, keyword index ${columnIndex}:`, error);
  }
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

async function getRanking(keyword, storeName) {
  console.log(`Starting getRanking (Top 20) for keyword: "${keyword}", storeName: "${storeName}"`);
  const options = { /* ... (以前と同じ) ... */ };
  console.log("!!! Launching Puppeteer with options:", JSON.stringify(options, null, 2));
  console.log("!!! Value of process.env.PUPPETEER_EXECUTABLE_PATH:", process.env.PUPPETEER_EXECUTABLE_PATH);

  let browser;
  try {
    browser = await puppeteer.launch(options);
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36');

    console.log(`Navigating to Google Maps for keyword: "${keyword}"`);
    const searchUrl = `http://googleusercontent.com/maps.google.com/6${encodeURIComponent(keyword)}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 90000 }); // タイムアウト延長

    console.log(`Waiting for search results (Top 20) for keyword: "${keyword}"`);
    // ★★★ 新しいセレクタ候補 (要検証・変更) ★★★
    // Googleの構造は頻繁に変わるので、これらのセレクタも試行錯誤が必要
    // 候補1: role="article" を持つdiv
    const resultSelector = 'div[role="article"]';
    // 候補2: より具体的なクラス名 (変わりやすい)
    // const resultSelector = '.Nv2PK'; // このクラス名は例。実際のクラス名を調査
    // 候補3: さらに別の構造を試す
    // const resultSelector = 'a.hfpxzc'; // リンク要素を試す場合など

    try {
      await page.waitForSelector(resultSelector, { timeout: 30000 }); // タイムアウトを30秒に
    } catch (waitError) {
      console.error(`Timeout or error waiting for search results selector (${resultSelector}) for keyword: "${keyword}".`);
      await browser.close();
      return "取得失敗(セレクタ)"; // エラー理由を明確化
    }

    // ★★★ スクロール処理は削除 ★★★

    console.log(`Extracting top 20 search results for keyword: "${keyword}"`);
    const items = await page.$$(resultSelector);
    console.log(`Found ${items.length} items initially for keyword: "${keyword}"`);

    let rank = 0; // 見つからない場合のデフォルト値を 0 に変更

    // ★★★ 上位20件に制限 ★★★
    const limit = Math.min(items.length, 20);
    console.log(`Checking top ${limit} items...`);

    for (let i = 0; i < limit; i++) {
      const item = items[i];
      let storeNameOnMap = '';
      try {
        // 店舗名の取得ロジック (セレクタは要検証)
        storeNameOnMap = await item.evaluate(el => {
            // 候補1: aria-label
            const ariaLabel = el.getAttribute('aria-label');
            if (ariaLabel) return ariaLabel;
            // 候補2: 特定のクラス名を持つ要素 (要検証)
            const titleElement = el.querySelector('.qBF1Pd span, .fontHeadlineSmall'); // 複数の可能性のあるセレクタ
            if (titleElement) return titleElement.textContent;
            return null;
        });

        if (storeNameOnMap) {
            storeNameOnMap = storeNameOnMap.trim();
             console.log(`Checking item ${i + 1}: "${storeNameOnMap}" against target: "${storeName}"`); // 必要ならログを有効化
            if (normalize(storeNameOnMap).includes(normalize(storeName))) {
              rank = i + 1;
              console.log(`Rank found: ${rank} for keyword: "${keyword}"`);
              break; // 見つかったらループ終了
            }
        } else {
             // console.log(`Could not extract store name from item ${i + 1}`);
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
    if (browser) {
      await browser.close();
    }
    return "取得失敗(エラー)"; // その他の予期せぬエラー
  }
}

// MEOランキング取得のエンドポイント
app.post("/meo-ranking", async (req, res) => {
  const sheetName = req.body.sheetName;
  console.log(`Received request for sheet: ${sheetName}`);
  if (!sheetName) {
    console.error("Sheet name not provided in request body.");
    return res.status(400).send("シート名が指定されていません");
  }

  try {
    const auth = await authorize();
    const keywords = await getKeywords(sheetName, auth);

    if (keywords.length === 0) {
        console.log(`No keywords found for sheet: ${sheetName}. Skipping ranking.`);
        return res.send(`順位計測スキップ (キーワードなし): ${sheetName}`);
    }

    console.log(`Processing ${keywords.length} keywords for sheet: ${sheetName}`);
    for (let i = 0; i < keywords.length; i++) {
      const keyword = keywords[i];
      const rank = await getRanking(keyword, sheetName);
      await writeRanking(sheetName, i, rank, auth);
    }

    console.log(`Finished processing all keywords for sheet: ${sheetName}`);
    res.send(`順位計測完了: ${sheetName}`);

  } catch (e) {
    console.error(`Unhandled error in /meo-ranking for sheet ${sheetName}:`, e);
    res.status(500).send(`サーバーエラー発生: ${e.message}`);
  }
});


// サーバー起動
const PORT = process.env.PORT || 3000; // PORTはRender.comが自動設定する場合が多い
app.listen(PORT, '0.0.0.0', () => { // '0.0.0.0' でリッスンすることが推奨される場合がある
  console.log(`✅ MEOサーバー稼働中： Port ${PORT}`);
});

// 未処理のPromise rejectionをハンドル (デバッグ用)
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // アプリケーションによってはここでプロセスを終了させることも検討
});

// SIGTERMシグナルをハンドル (Render.comからのシャットダウンシグナル)
process.on('SIGTERM', () => {
  console.info('SIGTERM signal received. Closing server.');
  // ここで必要なクリーンアップ処理（DB接続切断など）を行う
  process.exit(0);
});
