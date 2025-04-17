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

const spreadsheetId = process.env.SPREADSHEET_ID;
const credentials = JSON.parse(fs.readFileSync("creds.json"));

function normalize(str) {
  return decodeURIComponent(str).replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
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

  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges,
  });

  return res.data.valueRanges.flatMap((range) => range.values[0] || []);
}

async function writeRanking(sheetName, columnIndex, rank, auth) {
  const sheets = google.sheets({ version: "v4", auth });

  const getRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:A`,
  });
  const lastRow = (getRes.data.values || []).length + 1;

  const col = columnIndex < 6 ? 18 + columnIndex : 27 + (columnIndex - 6);
  const colLetter = colToLetter(col);
  const cell = `${colLetter}${lastRow}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!${cell}`,
    valueInputOption: "RAW",
    resource: { values: [[rank]] },
  });
}

function colToLetter(col) {
  let temp = "", letter = "";
  while (col > 0) {
    temp = (col - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    col = (col - temp - 1) / 26;
  }
  return letter;
}

async function getRanking(keyword, storeName) {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: process.env.CHROME_BIN || undefined
    });
  
    const page = await browser.newPage();
  
    await page.goto("https://www.google.com/maps");
    await page.waitForSelector("input[aria-label='検索']");
    await page.type("input[aria-label='検索']", keyword);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(5000);
  
    const items = await page.$$('div[role="article"]');
    let rank = "圏外";
  
    for (let i = 0; i < items.length; i++) {
      try {
        await items[i].click();
        await page.waitForTimeout(3000);
        const html = await page.content();
        if (normalize(html).includes(normalize(storeName))) {
          rank = i + 1;
          break;
        }
        await page.goBack({ waitUntil: "networkidle2" });
      } catch (_) {}
    }
  
    await browser.close();
    return rank;
  }  

app.post("/meo-ranking", async (req, res) => {
  const sheetName = req.body.sheetName;
  if (!sheetName) return res.status(400).send("シート名が指定されていません");

  try {
    const auth = await authorize();
    const keywords = await getKeywords(sheetName, auth);

    for (let i = 0; i < keywords.length; i++) {
      const rank = await getRanking(keywords[i], sheetName);
      await writeRanking(sheetName, i, rank, auth);
    }

    res.send("順位計測完了");
  } catch (e) {
    console.error(e);
    res.status(500).send("エラー発生: " + e.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ MEOサーバー稼働中：http://localhost:${PORT}`);
});
