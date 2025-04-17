#!/bin/bash
rm -rf node_modules package-lock.json /opt/render/.cache/puppeteer
PUPPETEER_SKIP_DOWNLOAD=false npm install puppeteer
