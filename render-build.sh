#!/bin/bash

set -e # エラーが発生したらスクリプトを停止する

echo "🧹 Clean up node_modules and puppeteer cache"
rm -rf node_modules package-lock.json /opt/render/.cache/puppeteer || echo "Cache clean skipped or failed"

echo "📦 Installing dependencies (skipping Puppeteer's browser download)"
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
npm install # package.json に基づいて依存関係をインストール

echo "🔧 Installing specific Chrome browser via puppeteer cli"
# npxコマンドでChromeをインストールし、インストール先のパスを変数に格納試行
# (出力からパスを取得する方が確実かもしれないが、一旦これで試す)
INSTALL_OUTPUT=$(npx puppeteer browsers install chrome)
echo "Install command output: $INSTALL_OUTPUT"

# 以前のビルドログから特定したパスをベースにする
CHROME_DIR="/opt/render/.cache/puppeteer/chrome/linux-135.0.7049.84/chrome-linux64"
CHROME_EXE_PATH="${CHROME_DIR}/chrome"

echo "🔍 Checking directory: ${CHROME_DIR}"
# ディレクトリが存在するか確認
if [ -d "${CHROME_DIR}" ]; then
  # ディレクトリの中身と権限を詳しく表示 (-al オプション)
  ls -al "${CHROME_DIR}"
else
  echo "Error: Directory ${CHROME_DIR} not found!"
fi

echo "🔍 Checking executable file: ${CHROME_EXE_PATH}"
# ファイルが存在し、実行可能か確認
if [ -x "${CHROME_EXE_PATH}" ]; then
  echo "✅ Chrome executable found and seems executable at: ${CHROME_EXE_PATH}"
else
  echo "Error: Chrome executable not found or not executable at: ${CHROME_EXE_PATH}"
  # find コマンドで再度探してみる（代替パス調査）
  echo "Attempting to find chrome executable again..."
  find /opt/render/.cache/puppeteer -type f -name '*chrome*' -executable -print -quit || echo "Alternative chrome executable not found."
  # ビルドは失敗させずに続行させる（ログ確認のため）
  # exit 1 # ここで終了させるとログが見れない場合がある
fi

echo "✅ Build process complete (check logs for file details)"