#!/bin/bash

set -e # エラーが発生したらスクリプトを停止する

echo "🚀 Starting build process..."

echo "apt-get update を実行中..."
apt-get update -y

echo "📦 Installing required OS dependencies for Puppeteer/Chrome..."
# Puppeteer のドキュメントや一般的な Linux 環境で必要とされるライブラリ
# 参考: https://pptr.dev/troubleshooting#running-puppeteer-on-linux
# 参考: https://github.com/puppeteer/puppeteer/blob/main/docs/troubleshooting.md#running-puppeteer-on-linux
apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils

echo "🧹 Clean up node_modules and puppeteer cache"
rm -rf node_modules package-lock.json /opt/render/.cache/puppeteer || echo "Cache clean skipped or failed"

echo "📦 Installing Node.js dependencies (skipping Puppeteer's browser download)"
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
npm install

echo "🔧 Installing specific Chrome browser via puppeteer cli"
INSTALL_OUTPUT=$(npx puppeteer browsers install chrome)
echo "Install command output: $INSTALL_OUTPUT"

CHROME_DIR="/opt/render/.cache/puppeteer/chrome/linux-135.0.7049.84/chrome-linux64"
CHROME_EXE_PATH="${CHROME_DIR}/chrome"

echo "🔍 Checking directory and executable: ${CHROME_EXE_PATH}"
if [ -d "${CHROME_DIR}" ]; then
  ls -al "${CHROME_DIR}"
else
  echo "Error: Directory ${CHROME_DIR} not found!"
fi

if [ -x "${CHROME_EXE_PATH}" ]; then
  echo "✅ Chrome executable found and seems executable at: ${CHROME_EXE_PATH}"
else
  echo "Error: Chrome executable not found or not executable at: ${CHROME_EXE_PATH}"
fi

echo "✅ Build process complete"