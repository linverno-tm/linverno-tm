'use strict';

/**
 * Controlled vocabularies.
 *
 * Every string that can describe a PRIVATE repository in the public output must
 * come from these tables (technology names, capability names, category names,
 * platform names, maturity names, anonymous titles). Detection inputs (dependency
 * names, file patterns, keywords) are matched against repository data but are
 * never themselves emitted.
 *
 * Dependency keys are namespaced by ecosystem: dart:, npm:, py:, php:, go:, rust:, gradle:.
 */

const TECHNOLOGIES = [
  // ── Languages (GitHub linguist byte counts; minBytes filters platform boilerplate) ──
  { name: 'Dart', group: 'mobile', lang: 'Dart' },
  { name: 'Kotlin', group: 'mobile', lang: 'Kotlin', minBytes: 4000 },
  { name: 'Swift', group: 'mobile', lang: 'Swift', minBytes: 4000 },
  { name: 'Java', group: 'backend', lang: 'Java', minBytes: 4000 },
  { name: 'TypeScript', group: 'web', lang: 'TypeScript' },
  { name: 'JavaScript', group: 'web', lang: 'JavaScript', minBytes: 4000 },
  { name: 'Python', group: 'backend', lang: 'Python' },
  { name: 'PHP', group: 'backend', lang: 'PHP' },
  { name: 'Go', group: 'backend', lang: 'Go' },
  { name: 'Rust', group: 'backend', lang: 'Rust' },
  { name: 'C#', group: 'backend', lang: 'C#' },
  { name: 'C++', group: 'backend', lang: 'C++', minBytes: 60000 },
  { name: 'C', group: 'backend', lang: 'C', minBytes: 20000 },
  { name: 'Ruby', group: 'backend', lang: 'Ruby' },
  { name: 'HTML', group: 'web', lang: 'HTML', minBytes: 6000 },
  { name: 'CSS', group: 'web', lang: ['CSS', 'SCSS', 'Less'], minBytes: 3000 },
  { name: 'Vue.js', group: 'web', lang: 'Vue', deps: ['npm:vue'] },
  { name: 'Svelte', group: 'web', lang: 'Svelte', deps: ['npm:svelte'] },
  { name: 'Shell', group: 'tools', lang: 'Shell', minBytes: 3000 },
  { name: 'PowerShell', group: 'tools', lang: 'PowerShell', minBytes: 1500 },
  { name: 'SQL', group: 'database', lang: ['PLpgSQL', 'TSQL', 'SQL', 'PLSQL'], minBytes: 1000 },
  { name: 'Jupyter', group: 'ai', lang: 'Jupyter Notebook' },

  // ── Mobile ──
  { name: 'Flutter', group: 'mobile', flag: 'flutter' },
  { name: 'Riverpod', group: 'mobile', deps: ['dart:flutter_riverpod', 'dart:riverpod', 'dart:hooks_riverpod'] },
  { name: 'Provider', group: 'mobile', deps: ['dart:provider'] },
  { name: 'Bloc', group: 'mobile', deps: ['dart:flutter_bloc', 'dart:bloc'] },
  { name: 'GetX', group: 'mobile', deps: ['dart:get'] },
  { name: 'Flame', group: 'mobile', deps: ['dart:flame'] },
  { name: 'React Native', group: 'mobile', deps: ['npm:react-native', 'npm:expo'] },

  // ── Web ──
  { name: 'Next.js', group: 'web', deps: ['npm:next'], files: [/^next\.config\.(js|mjs|cjs|ts)$/], keywords: ['next.js', 'nextjs'] },
  { name: 'React', group: 'web', deps: ['npm:react'] },
  { name: 'Nuxt', group: 'web', deps: ['npm:nuxt'] },
  { name: 'Angular', group: 'web', deps: ['npm:@angular/core'] },
  { name: 'Tailwind CSS', group: 'web', deps: ['npm:tailwindcss'], files: [/^tailwind\.config\.(js|cjs|mjs|ts)$/] },
  { name: 'Vite', group: 'web', deps: ['npm:vite'] },
  { name: 'WordPress', group: 'web', files: [/^wp-config\.php$/, /^wp-content\//], keywords: ['wordpress'] },
  { name: 'Laravel', group: 'backend', deps: ['php:laravel/framework'] },

  // ── Backend ──
  { name: 'Node.js', group: 'backend', flag: 'node' },
  { name: 'Express', group: 'backend', deps: ['npm:express'] },
  { name: 'NestJS', group: 'backend', deps: ['npm:@nestjs/core'] },
  { name: 'Fastify', group: 'backend', deps: ['npm:fastify'] },
  { name: 'Hono', group: 'backend', deps: ['npm:hono'] },
  { name: 'Cloudflare Workers', group: 'backend', deps: ['npm:@cloudflare/workers-types', 'npm:wrangler'], files: [/^wrangler\.(toml|json|jsonc)$/], keywords: ['cloudflare workers', 'cloudflare worker'] },
  { name: 'Cloud Functions', group: 'backend', deps: ['npm:firebase-functions'] },
  { name: 'FastAPI', group: 'backend', deps: ['py:fastapi'] },
  { name: 'Django', group: 'backend', deps: ['py:django'] },
  { name: 'Flask', group: 'backend', deps: ['py:flask'] },
  { name: 'REST APIs', group: 'backend', deps: ['dart:dio', 'dart:http', 'dart:retrofit', 'dart:chopper', 'npm:axios', 'py:requests', 'py:httpx', 'py:aiohttp'], keywords: ['rest api', 'rest-api'] },
  { name: 'GraphQL', group: 'backend', deps: ['npm:graphql', 'npm:@apollo/client', 'npm:apollo-server', 'dart:graphql_flutter'] },
  { name: 'WebSockets', group: 'backend', deps: ['npm:socket.io', 'npm:socket.io-client', 'npm:ws', 'dart:web_socket_channel', 'dart:socket_io_client', 'py:websockets'] },

  // ── Database / cloud ──
  { name: 'Firebase', group: 'database', deps: ['dart:firebase_core', 'dart:firebase_auth', 'dart:cloud_firestore', 'dart:firebase_messaging', 'dart:firebase_storage', 'dart:firebase_database', 'npm:firebase', 'npm:firebase-admin', 'npm:firebase-functions', 'py:firebase-admin'], files: [/^firebase\.json$/, /google-services\.json$/, /GoogleService-Info\.plist$/] },
  { name: 'Cloud Firestore', group: 'database', deps: ['dart:cloud_firestore', 'npm:@google-cloud/firestore'], files: [/^firestore\.rules$/, /^firestore\.indexes\.json$/] },
  { name: 'Supabase', group: 'database', deps: ['dart:supabase_flutter', 'npm:@supabase/supabase-js', 'py:supabase'] },
  { name: 'SQLite', group: 'database', deps: ['dart:sqflite', 'dart:sqflite_common_ffi', 'dart:sqlite3', 'dart:drift', 'npm:better-sqlite3', 'npm:sqlite3', 'npm:sqlite', 'py:aiosqlite', 'py:sqlite-utils'], files: [/\.(db|sqlite|sqlite3)$/], keywords: ['sqlite'] },
  { name: 'Hive', group: 'database', deps: ['dart:hive', 'dart:hive_flutter'] },
  { name: 'Isar', group: 'database', deps: ['dart:isar'] },
  { name: 'Cloudflare D1', group: 'database', flag: 'd1', keywords: ['cloudflare d1', 'd1 database'] },
  { name: 'PostgreSQL', group: 'database', deps: ['npm:pg', 'npm:postgres', 'py:psycopg2', 'py:psycopg2-binary', 'py:psycopg', 'py:asyncpg', 'dart:postgres'], keywords: ['postgresql', 'postgres'] },
  { name: 'MySQL', group: 'database', deps: ['npm:mysql2', 'npm:mysql', 'py:pymysql', 'py:mysqlclient', 'dart:mysql1'], keywords: ['mysql'] },
  { name: 'MongoDB', group: 'database', deps: ['npm:mongoose', 'npm:mongodb', 'py:pymongo', 'py:motor'], keywords: ['mongodb'] },
  { name: 'Redis', group: 'database', deps: ['npm:redis', 'npm:ioredis', 'py:redis'] },
  { name: 'Prisma', group: 'database', deps: ['npm:prisma', 'npm:@prisma/client'], files: [/schema\.prisma$/] },
  { name: 'Drizzle ORM', group: 'database', deps: ['npm:drizzle-orm'] },

  // ── AI / automation ──
  { name: 'OpenAI API', group: 'ai', deps: ['npm:openai', 'py:openai'] },
  { name: 'Anthropic API', group: 'ai', deps: ['npm:@anthropic-ai/sdk', 'py:anthropic'] },
  { name: 'Gemini API', group: 'ai', deps: ['py:google-generativeai', 'py:google-genai', 'npm:@google/generative-ai', 'npm:@google/genai'] },
  { name: 'LangChain', group: 'ai', deps: ['py:langchain', 'py:langchain-core', 'npm:langchain', 'npm:@langchain/core'] },
  { name: 'Telegram Bot API', group: 'ai', deps: ['npm:telegraf', 'npm:grammy', 'npm:node-telegram-bot-api', 'py:python-telegram-bot', 'py:aiogram', 'py:pytelegrambotapi', 'py:telebot', 'dart:teledart', 'dart:televerse'], keywords: ['telegram bot api', 'bot api', 'aiogram', 'grammy', 'telegraf'] },
  { name: 'pandas', group: 'ai', deps: ['py:pandas'] },
  { name: 'Playwright', group: 'tools', deps: ['npm:playwright', 'npm:@playwright/test', 'py:playwright'] },
  { name: 'Selenium', group: 'tools', deps: ['py:selenium', 'npm:selenium-webdriver'] },
  { name: 'Puppeteer', group: 'tools', deps: ['npm:puppeteer'] },

  // ── Tools / desktop ──
  { name: 'Docker', group: 'tools', files: [/(^|\/)Dockerfile$/, /^docker-compose\.ya?ml$/, /^compose\.ya?ml$/] },
  { name: 'GitHub Actions', group: 'tools', files: [/^\.github\/workflows\/.+\.ya?ml$/] },
  { name: 'Electron', group: 'tools', deps: ['npm:electron'] },
  { name: 'Tauri', group: 'tools', deps: ['npm:@tauri-apps/api'], files: [/^src-tauri\//] },
  { name: 'PyInstaller', group: 'tools', deps: ['py:pyinstaller'], files: [/^[^/]+\.spec$/] },
  { name: 'CustomTkinter', group: 'tools', deps: ['py:customtkinter'] },
  { name: 'Tkinter', group: 'tools', keywords: ['tkinter'] },
  { name: 'PyQt', group: 'tools', deps: ['py:pyqt5', 'py:pyqt6', 'py:pyside6'] },
  { name: 'Flet', group: 'tools', deps: ['py:flet'] },
];

const CAPABILITIES = [
  { name: 'Authentication', deps: ['dart:firebase_auth', 'dart:google_sign_in', 'dart:sign_in_with_apple', 'dart:local_auth', 'npm:next-auth', 'npm:@auth/core', 'npm:jsonwebtoken', 'npm:passport', 'npm:bcrypt', 'npm:bcryptjs', 'npm:@clerk/nextjs', 'py:python-jose', 'py:passlib', 'py:pyjwt', 'py:django-allauth'], keywords: ['authentication', 'auth flow', 'login', 'sign-in', 'sign in', 'oauth', 'jwt'] },
  { name: 'Offline-first sync', deps: ['dart:connectivity_plus', 'dart:workmanager'], keywords: ['offline-first', 'offline first', 'offline', 'synchroniz', 'sync service', 'auto-sync', 'auto sync', 'sinxron'] },
  { name: 'Push notifications', deps: ['dart:firebase_messaging', 'dart:flutter_local_notifications', 'dart:onesignal_flutter', 'dart:awesome_notifications', 'npm:web-push', 'npm:expo-notifications'], keywords: ['push notification', 'notifications', 'bildirishnoma'] },
  { name: 'Real-time updates', deps: ['npm:socket.io', 'npm:ws', 'dart:web_socket_channel', 'dart:socket_io_client', 'py:websockets', 'npm:pusher-js'], keywords: ['real-time', 'realtime', 'live updates', 'websocket'] },
  { name: 'Local database', deps: ['dart:sqflite', 'dart:sqflite_common_ffi', 'dart:drift', 'dart:hive', 'dart:hive_flutter', 'dart:isar', 'dart:objectbox', 'dart:sqlite3', 'npm:better-sqlite3', 'py:aiosqlite'], keywords: ['sqlite', 'local database', 'local storage', 'local persistence'] },
  { name: 'Cloud synchronization', deps: ['dart:cloud_firestore', 'dart:firebase_database', 'dart:supabase_flutter', 'npm:firebase'], keywords: ['cloud sync', 'firestore', 'cloud synchronization', 'bulut'] },
  { name: 'State management', deps: ['dart:flutter_riverpod', 'dart:riverpod', 'dart:hooks_riverpod', 'dart:provider', 'dart:flutter_bloc', 'dart:get', 'dart:mobx', 'npm:zustand', 'npm:@reduxjs/toolkit', 'npm:redux', 'npm:pinia', 'npm:mobx'] },
  { name: 'Inventory management', keywords: ['inventory', 'stock management', 'stock tracking', 'warehouse', 'ombor', 'omborxona', 'sklad', 'склад', 'tovar', 'товар', 'mahsulot'] },
  { name: 'Sales & POS', keywords: ['sales', 'point of sale', 'pos', 'smartpos', 'cashier', 'kassa', 'savdo', 'sotuv', 'sotish', 'продаж', 'касса'] },
  { name: 'Installment & credit tracking', keywords: ['installment', 'nasiya', 'muddatli', 'рассрочк', 'credit tracking', 'qarz', 'debt tracking', "bo'lib to'lash", 'bolib tolash'] },
  { name: 'Customer management', keywords: ['crm', 'customer management', 'customers', 'customer', 'client management', 'mijoz', 'клиент'] },
  { name: 'Employee & HR workflows', keywords: ['workforce', 'employee', 'employees', 'human resources', 'xodim', 'сотрудник', 'attendance', 'davomat', 'payroll', 'shift planning'] },
  { name: 'ERP integration', keywords: ['erp', '1c', '1с', 'sap', 'odoo', 'ksb', 'merp', 'smartpos'] },
  { name: 'Multi-branch data consolidation', keywords: ['filial', 'multi-branch', 'birlashtir', 'consolidat', 'филиал', 'multiple databases'] },
  { name: 'Reporting & analytics', deps: ['dart:fl_chart', 'dart:syncfusion_flutter_charts', 'npm:recharts', 'npm:chart.js', 'npm:apexcharts', 'py:matplotlib', 'py:plotly'], keywords: ['report', 'reports', 'reporting', 'hisobot', 'analytics', 'dashboard', 'отчет', 'отчёт', 'statistics', 'statistika'] },
  { name: 'Excel & PDF processing', deps: ['py:openpyxl', 'py:xlsxwriter', 'py:xlrd', 'py:xlwt', 'py:reportlab', 'py:pypdf', 'py:pypdf2', 'py:pdfplumber', 'py:fpdf', 'py:fpdf2', 'py:python-docx', 'dart:excel', 'dart:syncfusion_flutter_xlsio', 'dart:pdf', 'dart:syncfusion_flutter_pdf', 'npm:exceljs', 'npm:xlsx', 'npm:pdfkit', 'npm:pdf-lib', 'npm:jspdf', 'npm:docx'], keywords: ['excel', 'xlsx', '.xls', 'pdf', 'spreadsheet'] },
  { name: 'Bank statement processing', keywords: ['bank statement', 'bank hisobot', 'bank-statement', 'client-bank', 'выписк', 'bank vypiska', 'bank statements'] },
  { name: 'Accounting & invoicing', keywords: ['accounting', 'buxgalter', 'бухгалтер', 'invoice', 'invoices', 'faktura', 'hisob-faktura', 'счет-фактур', 'счёт-фактур', 'ledger', 'bookkeeping', 'e-invoic', 'kameral', 'audit', 'soliq', 'tax'] },
  { name: 'Payments integration', deps: ['npm:stripe', 'py:stripe', 'dart:flutter_stripe', 'npm:@stripe/stripe-js', 'dart:razorpay_flutter'], keywords: ['payment', 'payments', 'payme', "to'lov", 'tolov', 'оплат', 'stripe', 'checkout'] },
  { name: 'Telegram bot automation', deps: ['npm:telegraf', 'npm:grammy', 'npm:node-telegram-bot-api', 'py:python-telegram-bot', 'py:aiogram', 'py:pytelegrambotapi', 'py:telebot', 'dart:teledart', 'dart:televerse'], keywords: ['telegram bot', 'telegram-bot', 'telegram boti', 'telegram-boti', 'vazifa boti', 'bot api'], nameKeywords: ['bot'] },
  { name: 'AI integration', deps: ['npm:openai', 'py:openai', 'npm:@anthropic-ai/sdk', 'py:anthropic', 'py:google-generativeai', 'py:google-genai', 'npm:@google/generative-ai', 'npm:@google/genai', 'py:langchain', 'npm:langchain'], keywords: ['openai', 'gpt', 'llm', 'claude', 'gemini', 'ai-powered', 'ai assistant', 'ai-assisted', 'machine learning', 'chatgpt', 'anthropic', "sun'iy intellekt"] },
  { name: 'Data processing', deps: ['py:pandas', 'py:numpy', 'py:polars', 'py:pyarrow', 'npm:papaparse', 'npm:csv-parse', 'dart:csv'], keywords: ['data processing', 'etl', 'parser', 'parsing', 'converter', 'convert', 'aylantir', 'normaliz', 'dedup'] },
  { name: 'Browser automation & scraping', deps: ['py:playwright', 'py:selenium', 'py:beautifulsoup4', 'py:scrapy', 'py:lxml', 'npm:puppeteer', 'npm:playwright', 'npm:cheerio'], keywords: ['scraping', 'scraper', 'crawler', 'browser automation', 'web automation'] },
  { name: 'Scheduled jobs', deps: ['npm:node-cron', 'npm:cron', 'py:apscheduler', 'py:schedule', 'py:celery', 'py:croniter'], keywords: ['scheduler', 'cron', 'scheduled job', 'scheduled task', 'daily report', 'kunlik hisobot', 'har kuni'] },
  { name: 'API integration', deps: ['dart:dio', 'dart:http', 'dart:retrofit', 'npm:axios', 'py:requests', 'py:httpx', 'py:aiohttp'], keywords: ['api integration', 'rest api', 'third-party api', 'external api'] },
  { name: 'Background services', deps: ['dart:workmanager', 'dart:flutter_foreground_task', 'dart:flutter_background_service', 'dart:android_alarm_manager_plus', 'dart:foreground_service'], keywords: ['foreground service', 'background service', 'background task', 'background processing'] },
  { name: 'Native platform integration', flag: 'nativeInFlutter', keywords: ['methodchannel', 'method channel', 'platform channel', 'native kotlin', 'native swift', 'native code', 'native android', 'native ios'] },
  { name: 'Maps & geolocation', deps: ['dart:google_maps_flutter', 'dart:geolocator', 'dart:mapbox_gl', 'dart:flutter_map', 'dart:location', 'npm:leaflet', 'npm:mapbox-gl', 'npm:@react-google-maps/api'], keywords: ['google maps', 'geolocation', 'gps', 'location tracking', 'xarita'] },
  { name: 'Camera & QR scanning', deps: ['dart:camera', 'dart:mobile_scanner', 'dart:qr_code_scanner', 'dart:qr_flutter', 'dart:image_picker', 'dart:barcode_scan2', 'dart:flutter_barcode_scanner'], keywords: ['qr code', 'qr-code', 'barcode', 'scanner', 'skaner'] },
  { name: 'Receipt printing', deps: ['dart:esc_pos_utils', 'dart:esc_pos_utils_plus', 'dart:esc_pos_printer', 'dart:blue_thermal_printer', 'dart:bluetooth_print', 'dart:printing'], keywords: ['receipt', 'thermal print', 'printer', 'chek chop', 'печать чек'] },
  { name: 'Multi-language (i18n)', deps: ['dart:easy_localization', 'dart:flutter_localizations', 'dart:slang', 'npm:i18next', 'npm:next-intl', 'npm:react-i18next', 'npm:vue-i18n'], keywords: ['localization', 'i18n', 'multi-language', 'multilingual', 'trilingual', 'bilingual', "ko'p tilli", 'uz/ru/en'] },
  { name: 'Role-based access', keywords: ['role-based', 'rbac', 'admin panel', 'permissions', 'user roles', 'roles', 'security rules', 'ownership-scoped'] },
  { name: 'SMS & messaging', deps: ['npm:twilio', 'py:twilio', 'npm:nodemailer', 'dart:flutter_sms', 'dart:telephony', 'dart:another_telephony', 'dart:sms_advanced'], keywords: ['sms', 'bulk sms', 'email sending', 'messenger', 'messaging', 'chat'] },
  { name: 'File import/export', deps: ['dart:file_picker', 'npm:multer', 'dart:share_plus', 'dart:open_file'], keywords: ['import', 'export', 'csv', 'file upload', 'eksport'] },
  { name: 'Game mechanics', deps: ['dart:flame', 'py:pygame', 'npm:phaser', 'npm:three', 'npm:pixi.js'], keywords: ['game loop', 'physics', 'collision', 'endless runner', 'game'] },
  { name: 'CI/CD pipelines', files: [/^\.github\/workflows\/.+\.ya?ml$/], keywords: ['ci/cd', 'continuous integration', 'ci on every push'] },
  { name: 'Desktop packaging', deps: ['py:pyinstaller', 'py:cx-freeze', 'py:nuitka', 'npm:electron-builder'], files: [/^[^/]+\.spec$/, /\.iss$/, /\.msix$/], keywords: ['.exe', 'installer', 'windows dastur', 'desktop dastur'] },
  { name: 'Desktop UI', deps: ['py:customtkinter', 'py:pyqt5', 'py:pyqt6', 'py:pyside6', 'py:flet', 'py:kivy', 'npm:electron', 'npm:@tauri-apps/api'], keywords: ['tkinter', 'desktop app', 'desktop dastur', 'windows app'] },
  { name: 'Static site generation', keywords: ['static export', 'statik eksport', 'static site', 'landing page', 'landing'] },
  { name: 'Task & schedule management', keywords: ['task manager', 'tasks', 'vazifa', 'to-do', 'todo', 'timetable', 'schedule', 'dars jadvali', 'reminder', 'eslatma', 'календар', 'расписание', 'задач'] },
];

/**
 * Category rules. `domain` categories describe what a project is for; `platform`
 * categories describe where it runs. A repository may belong to several.
 */
const CATEGORIES = [
  { name: 'Business Software', domain: true, caps: { 'Inventory management': 3, 'Sales & POS': 3, 'Accounting & invoicing': 3, 'Bank statement processing': 3, 'Installment & credit tracking': 3, 'Customer management': 3, 'Employee & HR workflows': 3, 'ERP integration': 2, 'Multi-branch data consolidation': 2, 'Receipt printing': 2, 'Reporting & analytics': 1 }, keywords: { business: 1, biznes: 1, retail: 2, shop: 1, store: 1, "do'kon": 2, dokon: 2, savdo: 2, crm: 3, erp: 3, operations: 1 } },
  { name: 'E-commerce', domain: true, caps: { 'Payments integration': 1 }, keywords: { 'e-commerce': 4, ecommerce: 4, 'online store': 4, 'online shop': 4, marketplace: 4, cart: 2, checkout: 2, 'product catalog': 2, 'internet magazin': 3, 'internet-magazin': 3 } },
  { name: 'AI & Automation', domain: true, minScore: 3, techs: { 'OpenAI API': 3, 'Anthropic API': 3, 'Gemini API': 3, LangChain: 3, 'Telegram Bot API': 3, Playwright: 1, Selenium: 2, Puppeteer: 2 }, caps: { 'AI integration': 3, 'Telegram bot automation': 3, 'Browser automation & scraping': 3, 'Scheduled jobs': 2, 'Data processing': 1 }, keywords: { automation: 2, avtomat: 2 }, nameKeywords: { bot: 3 } },
  { name: 'Games', domain: true, techs: { Flame: 4 }, caps: { 'Game mechanics': 3 }, keywords: { game: 2, runner: 1, arcade: 2, puzzle: 2, "o'yin": 2 } },
  { name: 'Productivity', domain: true, caps: { 'Task & schedule management': 3 }, keywords: { todo: 3, 'to-do': 3, 'task manager': 3, planner: 3, habit: 3, notes: 2, reminder: 2, 'second brain': 3, pomodoro: 3, timetable: 3, 'dars jadvali': 3, productivity: 2 } },
  { name: 'Developer Tools', domain: true, minScore: 3, keywords: { cli: 3, 'command-line': 3, 'command line': 3, 'command-line tool': 3, sdk: 2, boilerplate: 2, 'starter kit': 2, tooling: 2, 'dev tool': 3, 'developer tool': 3, 'developer tools': 3, 'vs code extension': 3, 'browser extension': 3 }, nameKeywords: { cli: 3, tool: 2, tools: 2, utils: 2, generator: 2, plugin: 3, sdk: 3, lib: 2 }, files: { action: 3 }, flags: { dartPackage: 3, npmBin: 3, pyPackage: 3 } },
  { name: 'Infrastructure', domain: true, keywords: { terraform: 3, kubernetes: 3, k8s: 3, helm: 3, ansible: 3, infrastructure: 2, devops: 2, nginx: 1 }, files: { terraform: 3, helm: 3, ansible: 2 } },
  { name: 'Mobile Applications', platform: true, techs: { Flutter: 3, 'React Native': 3, Kotlin: 1, Swift: 1 }, flags: { flutterMobile: 1, androidNative: 3, iosNative: 3 }, keywords: { 'mobile app': 2, android: 1, ios: 1, 'mobil ilova': 2 } },
  { name: 'Web Applications', platform: true, techs: { 'Next.js': 3, React: 2, 'Vue.js': 3, Nuxt: 3, Angular: 3, Svelte: 3, 'Tailwind CSS': 1, HTML: 1, CSS: 1, WordPress: 3, Laravel: 2 }, flags: { flutterWebOnly: 3, staticSite: 2 }, keywords: { website: 2, 'landing page': 3, landing: 2, 'web app': 2, 'web application': 2, frontend: 2, sayt: 2, сайт: 2, dashboard: 1 } },
  { name: 'Backend Systems', platform: true, minScore: 3, techs: { Express: 3, NestJS: 3, Fastify: 3, Hono: 3, FastAPI: 3, Django: 3, Flask: 3, 'Cloud Functions': 2, 'Cloudflare Workers': 2, PostgreSQL: 1, MongoDB: 1, Redis: 1, Prisma: 1, Docker: 1, GraphQL: 1 }, keywords: { backend: 2, 'rest api': 1, server: 1, microservice: 2, 'api service': 2 } },
  { name: 'Desktop Applications', platform: true, minScore: 3, techs: { Electron: 3, Tauri: 3, PyInstaller: 2, CustomTkinter: 3, Tkinter: 3, PyQt: 3, Flet: 2 }, caps: { 'Desktop UI': 2, 'Desktop packaging': 2 }, flags: { flutterDesktopOnly: 3 }, keywords: { 'desktop app': 3, 'desktop application': 3, 'desktop dastur': 3, 'windows app': 3, 'windows dasturi': 3, 'windows desktop': 3, desktop: 1, windows: 1, '.exe': 2 } },
  { name: 'Experimental', domain: true, minScore: 3, keywords: { experiment: 3, experimental: 3, prototype: 3, playground: 3, sandbox: 3, poc: 3, 'proof of concept': 3, demo: 2, learning: 2, tutorial: 2, practice: 2, 'test project': 3, example: 1, sinov: 3, tajriba: 3 }, flags: { tiny: 1 } },
];

const PLATFORMS = { 'Mobile Applications': 'Mobile', 'Web Applications': 'Web', 'Backend Systems': 'Backend', 'Desktop Applications': 'Desktop' };
const MATURITY = ['Active', 'Maintained', 'Experimental', 'Archived'];

/** Anonymous titles for private repositories (the complete allowed set). */
const PRIVATE_TITLES = [
  'Retail Operations Platform', 'Financial Reporting Tool', 'Customer Management System', 'Workforce Management System', 'Business Management System',
  'E-commerce Application', 'Telegram Automation Bot', 'AI-Assisted Workflow Tool', 'Data Automation Pipeline', 'Automation Service',
  'Mobile Game', 'Game Project', 'Mobile Productivity App', 'Productivity Application', 'Internal Developer Tool', 'Infrastructure Configuration',
  'Mobile Business Application', 'Mobile Application', 'Web Dashboard', 'Marketing Website', 'Web Platform', 'API Service', 'Windows Desktop Tool',
  'Experimental Project', 'Software Project',
];

/** Repositories that are not software projects (backups, notes, config mirrors). */
const NON_PROJECT_KEYWORDS = ['backup', 'zaxira', 'zahira', 'dotfiles', 'my notes', 'config files', 'mirror of', 'archive of', 'obsidian vault', 'profile readme', 'github profile'];

/** Generic words that must never count as "private identifiers" (English + common Uzbek/Russian tech words). */
const STOPWORDS = new Set(('private public repo repository project projects app apps application applications system systems platform service services bot bots tool tools site sites web mobile desktop backend frontend api apis data base database client clients server admin panel manager management report reports reporting daily weekly monthly sync auto automatic automation integration integrations business retail shop store sales inventory stock finance financial accounting invoice invoices customer customers user users task tasks todo notes note timetable schedule game games runner chat messenger sms email files file excel pdf python dart flutter typescript javascript kotlin swift java html css php node react next vue angular svelte firebase firestore supabase sqlite postgres mysql mongodb redis docker github actions telegram openai anthropic gemini cloud cloudflare workers functions landing page website design template starter demo test tests example examples experiment prototype learning tutorial practice new old main master dev prod version beta alpha release for and the with from into your our their this that uchun bilan boti ilova dastur dasturi sayt tizim tizimi hisobot generator cleaner converter parser bulk simple smart mini micro lite pro plus core lib libs package packages script scripts workspace folder university daily crm').split(/\s+/));

const ALLOWED_OUTPUT_STRINGS = new Set([
  ...TECHNOLOGIES.map((t) => t.name),
  ...CAPABILITIES.map((c) => c.name),
  ...CATEGORIES.map((c) => c.name),
  ...Object.values(PLATFORMS),
  ...MATURITY,
  ...PRIVATE_TITLES,
]);

module.exports = { TECHNOLOGIES, CAPABILITIES, CATEGORIES, PLATFORMS, MATURITY, PRIVATE_TITLES, NON_PROJECT_KEYWORDS, STOPWORDS, ALLOWED_OUTPUT_STRINGS };
