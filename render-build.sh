#!/bin/bash

echo "🧹 Clean start: removing previous installs"
rm -rf node_modules package-lock.json /opt/render/.cache/puppeteer

echo "⬇️ Installing Puppeteer with Chromium"
PUPPETEER_SKIP_DOWNLOAD=false npm install puppeteer

echo "⬇️ Installing remaining dependencies"
npm install

echo "🔍 Checking if puppeteer-core is installed"
npm ls puppeteer-core || echo "✅ puppeteer-core is not installed"
