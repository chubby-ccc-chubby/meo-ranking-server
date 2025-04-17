// server.js (デバッグログ追加版)
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const puppeteer = require("puppeteer");
const { google } = require("googleapis");
const fs = require("fs");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// SPREADSHEET_ID は Render.com の環境変数で設定することを推奨
const spreadsheetId = process.env.SPREADSHEET_ID;
// creds.json の内容も Render.com の Secret File で管理することを推奨
let credentials;
try {
  credentials = JSON.parse(fs.readFileSync("creds.json"));
} catch (error) {
  console.error("Error reading or parsing creds.json:", error);
  // 適切なエラー処理、または環境変数からの読み込みに変更することを検討
  process.exit(1); // 認証情報がないと続行できないため終了する例
}


function normalize(str) {
  // null や undefined の場合も考慮
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
    // キーワード範囲を修正（1行目全体ではなく、具体的な範囲を指定）
    // R1:W1 と AA1:AO1 で合計 6 + 15 = 21 個のキーワードを想定
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

      // キーワード配列を展開して、空でないものだけを残す
      const keywords = res.data.valueRanges.flatMap((range) => {
        // values が存在し、かつ配列であることを確認
        return (range.values && Array.isArray(range.values) && range.values.length > 0 && Array.isArray(range.values[0]))
               ? range.values[0].filter((v) => v && String(v).trim() !== "")
               : [];
      });

      console.log(`Found keywords: ${keywords.join(', ')}`);
      return keywords;
    } catch (error) {
      console.error(`Error fetching keywords for sheet ${sheetName}:`, error);
      throw error; // エラーを再スローして呼び出し元で処理
    }
}

async function writeRanking(sheetName, columnIndex, rank, auth) {
  const sheets = google.sheets({ version: "v4", auth });

  try {
    // 最終行をより確実に取得 (A列末尾 + 1)
    const getRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:A`, // A列全体を指定
      majorDimension: 'COLUMNS' // 列として取得
    });

    // A列に値がある最後の行番号を取得 (なければ0)
    const lastRowA = getRes.data.values && getRes.data.values[0] ? getRes.data.values[0].length : 0;
    const targetRow = lastRowA + 1; // 書き込む行は最終行の次

    // 列番号の計算 (0始まりのcolumnIndexから1始まりの列番号へ)
    // R列 = 18, AA列 = 27
    const targetColIndex = columnIndex < 6
                          ? 18 + columnIndex // R, S, T, U, V, W (0-5) -> 18-23
                          : 27 + (columnIndex - 6); // AA, AB,... AO (6-20) -> 27-41

    const targetColLetter = colToLetter(targetColIndex); // 1始まりの列番号をアルファベットに変換
    const targetCell = `${sheetName}!${targetColLetter}${targetRow}`;

    console.log(`Writing rank ${rank} to ${targetCell} (Keyword index: ${columnIndex})`);

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: targetCell, // A1表記法でセルを指定
      valueInputOption: "RAW",
      resource: { values: [[rank]] }, // 値は2次元配列で渡す
    });
  } catch (error) {
      console.error(`Error writing rank for sheet ${sheetName}, keyword index ${columnIndex}:`, error);
      // エラーが発生しても処理を続行させるか、ここで停止させるか検討
  }
}

// 1始まりの列番号をアルファベット表記に変換する関数
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
  console.log(`Starting getRanking for keyword: "${keyword}", storeName: "${storeName}"`);
  const options = {
      headless: true, // 本番環境では true が基本
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // /dev/shm の容量不足対策
        '--disable-accelerated-2d-canvas', // パフォーマンス関連
        '--no-first-run',
        '--no-zygote',
        // '--single-process', // メモリ使用量を抑えるが不安定になる可能性も
        '--disable-gpu' // GPUを使わない
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      // timeout: 60000 // ブラウザ起動のタイムアウト（ミリ秒、必要に応じて設定）
  };
  // ▼▼▼ デバッグログを追加 ▼▼▼
  console.log("!!! Launching Puppeteer with options:", JSON.stringify(options, null, 2));
  console.log("!!! Value of process.env.PUPPETEER_EXECUTABLE_PATH:", process.env.PUPPETEER_EXECUTABLE_PATH);
  // ▲▲▲ ここまで追加 ▲▲▲

  let browser;
  try {
    browser = await puppeteer.launch(options);
    const page = await browser.newPage();
    // ユーザーエージェントを設定（ブロック対策）
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36');

    console.log(`Navigating to Google Maps for keyword: "${keyword}"`);
    // Google マップの検索結果ページに直接遷移する方が安定する可能性
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(keyword)}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 }); // タイムアウトを長めに

    console.log(`Waiting for search results for keyword: "${keyword}"`);
    // 検索結果の要素が表示されるのを待つセレクタ (変更される可能性あり)
    // 'div[role="article"]' またはより具体的なセレクタ
    const resultSelector = 'div[jsaction*="mouseover:pane"]'; // このセレクタは検証が必要
    try {
      await page.waitForSelector(resultSelector, { timeout: 15000 }); // 待機時間を設定
    } catch (waitError) {
        console.error(`Timeout or error waiting for search results selector (${resultSelector}) for keyword: "${keyword}". Assuming no results or page structure changed.`);
        await browser.close();
        return "取得失敗(タイムアウト)"; // タイムアウトまたはセレクタが見つからない場合
    }

    console.log(`Extracting search results for keyword: "${keyword}"`);
    // 検索結果リストのアイテムを取得 (セレクタは変更の可能性あり)
    const items = await page.$$(resultSelector);
    console.log(`Found ${items.length} items in search results for keyword: "${keyword}"`);

    let rank = "圏外";

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      let storeNameOnMap = '';
      try {
        // 各アイテムから店舗名を取得する試み (セレクタは非常に変わりやすい)
        // 例1: aria-label を使う (存在すれば)
        const ariaLabel = await item.evaluate(el => el.getAttribute('aria-label'));
        if (ariaLabel) {
            storeNameOnMap = ariaLabel;
        } else {
            // 例2: 特定のクラス名を持つ要素のテキストを取得 (構造依存)
            const nameElement = await item.$('.fontHeadlineSmall'); // 例: クラス名
            if (nameElement) {
                storeNameOnMap = await nameElement.evaluate(el => el.textContent);
            }
        }

        storeNameOnMap = storeNameOnMap.trim(); // 前後の空白を削除
        console.log(`Checking item ${i + 1}: "${storeNameOnMap}" against target: "${storeName}"`);

        // 店舗名の一致判定 (normalize関数を使用)
        if (storeNameOnMap && normalize(storeNameOnMap).includes(normalize(storeName))) {
          rank = i + 1;
          console.log(`Rank found: ${rank} for keyword: "${keyword}"`);
          break; // 一致したらループを抜ける
        }
      } catch (evalError) {
        console.error(`Error processing item ${i + 1} for keyword: "${keyword}"`, evalError);
        // エラーが発生しても次のアイテムへ
      }
    }

    if (rank === "圏外") {
        console.log(`Store "${storeName}" not found in the first page results for keyword: "${keyword}"`);
    }

    await browser.close();
    console.log(`Finished getRanking for keyword: "${keyword}". Rank: ${rank}`);
    return rank;

  } catch (error) {
    console.error(`Error in getRanking for keyword "${keyword}":`, error);
    if (browser) {
      await browser.close(); // エラー時もブラウザを閉じる
    }
    // エラー発生を示す値を返す
    return "取得失敗(エラー)";
  }
}

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
        // キーワードがない場合でも正常終了として応答を返す
        return res.send(`順位計測スキップ (キーワードなし): ${sheetName}`);
    }

    console.log(`Processing ${keywords.length} keywords for sheet: ${sheetName}`);
    // 各キーワードの処理を順番に実行 (並列実行はリソースを圧迫する可能性)
    for (let i = 0; i < keywords.length; i++) {
      const keyword = keywords[i];
      // getRanking 関数を呼び出し
      const rank = await getRanking(keyword, sheetName); // storeName としてシート名を使用
      // writeRanking 関数を呼び出し
      await writeRanking(sheetName, i, rank, auth); // columnIndex はキーワードのインデックス(0始まり)
    }

    console.log(`Finished processing all keywords for sheet: ${sheetName}`);
    res.send(`順位計測完了: ${sheetName}`);

  } catch (e) {
    console.error(`Unhandled error in /meo-ranking for sheet ${sheetName}:`, e);
    res.status(500).send(`サーバーエラー発生: ${e.message}`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  // Render.com では 0.0.0.0 でリッスンすることが推奨される場合がある
  console.log(`✅ MEOサーバー稼働中： Port ${PORT}`);
});