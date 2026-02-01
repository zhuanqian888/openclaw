#!/usr/bin/env node
/**
 * MiniMax 余额查询脚本
 * 每小时执行一次，将余额保存到 GitHub 仓库
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// MiniMax Cookie（从环境变量读取或文件读取）
function getCookie() {
  // 优先从文件读取
  const cookieFile = path.join(__dirname, '..', 'minimax-cookie.json');
  if (fs.existsSync(cookieFile)) {
    const cookieData = JSON.parse(fs.readFileSync(cookieFile, 'utf8'));
    return cookieData.cookie;
  }
  // 从环境变量读取
  return process.env.MINIMAX_COOKIE || '';
}

function formatDate() {
  const now = new Date();
  return now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
}

async function fetchBalance() {
  const cookie = getCookie();
  if (!cookie) {
    throw new Error('未找到 MiniMax cookie，请在 minimax-cookie.json 中配置');
  }

  // 尝试访问用户中心页面
  const url = 'https://platform.minimaxi.com/user-center/basic-information';

  // 使用 puppeteer 访问页面并提取余额
  const puppeteer = require('puppeteer');

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  try {
    const page = await browser.newPage();

    // 设置 cookie
    const cookies = cookie.split(';').map(c => {
      const [name, ...value] = c.trim().split('=');
      return { name: name, value: value.join('='), domain: '.minimaxi.com' };
    });
    await page.setCookie(...cookies);

    // 访问页面
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

    // 等待页面加载，尝试查找余额相关元素
    await page.waitForSelector('body', { timeout: 10000 });

    // 获取页面内容，查找余额信息
    const content = await page.evaluate(() => {
      // 尝试查找常见的余额显示元素
      const selectors = [
        '[class*="balance"]',
        '[class*="credit"]',
        '[class*="amount"]',
        '[class*="quota"]',
        'span',
        'div'
      ];

      for (const sel of selectors) {
        const elements = document.querySelectorAll(sel);
        elements.forEach(el => {
          const text = el.innerText;
          if (text && (text.includes('¥') || text.includes('元') || /\d+\.\d{2}/.test(text))) {
            console.log(`Found: ${text}`);
          }
        });
      }

      // 返回整个 body 的文本内容用于分析
      return document.body.innerText;
    });

    console.log('Page content loaded');

    // 尝试查找 API 调用
    const apiCalls = await page.evaluate(() => {
      const requests = performance.getEntriesByType('resource')
        .filter(r => r.initiatorType === 'fetch' || r.initiatorType === 'xhr')
        .map(r => ({ name: r.name, type: r.initiatorType }));
      return requests.slice(-10); // 最近10个
    });

    console.log('API calls:', JSON.stringify(apiCalls, null, 2));

    // 如果找到余额相关的 API，直接调用
    for (const call of apiCalls) {
      if (call.name.includes('balance') || call.name.includes('credit') || call.name.includes('quota')) {
        try {
          const response = await page.evaluate(async (url) => {
            const res = await fetch(url);
            return await res.json();
          }, call.name);
          console.log('Balance API response:', JSON.stringify(response, null, 2));
          return response;
        } catch (e) {
          console.log('Failed to fetch API:', e.message);
        }
      }
    }

    return { status: 'page_loaded', content_preview: content.substring(0, 500) };

  } finally {
    await browser.close();
  }
}

async function saveToGitHub(balanceData) {
  const date = formatDate();

  const record = `## ${date}\n${JSON.stringify(balanceData, null, 2)}\n\n`;

  const balanceFile = path.join(__dirname, '..', 'MINIMAX_BALANCE.md');

  // 读取现有内容
  let existingContent = '';
  if (fs.existsSync(balanceFile)) {
    existingContent = fs.readFileSync(balanceFile, 'utf8');
  }

  // 在顶部添加新记录
  const newContent = `# MiniMax 余额记录\n\n${record}\n---\n\n${existingContent}`;

  fs.writeFileSync(balanceFile, newContent);
  console.log(`余额已保存到 ${balanceFile}`);

  // 尝试提交到 GitHub
  try {
    const repoDir = path.join(__dirname, '..');
    execSync('git add -A', { cwd: repoDir });
    execSync(`git commit -m "docs: 更新 MiniMax 余额 - ${date}"`, { cwd: repoDir });
    execSync('git push origin main', { cwd: repoDir });
    console.log('已同步到 GitHub');
  } catch (e) {
    console.log('Git 同步失败:', e.message);
  }
}

async function main() {
  console.log('=== MiniMax 余额查询 ===');
  console.log(`时间: ${formatDate()}`);

  try {
    const balance = await fetchBalance();
    console.log('余额信息:', JSON.stringify(balance, null, 2));

    await saveToGitHub({
      timestamp: formatDate(),
      data: balance
    });

    console.log('完成!');
  } catch (error) {
    console.error('错误:', error.message);
    process.exit(1);
  }
}

main();
