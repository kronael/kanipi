import fs from 'fs';
import path from 'path';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import readline from 'readline';

import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';

import type { ChannelAuth } from './channel-auth.js';

const logger = pino({ level: 'warn' });

function askQuestion(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function connectSocket(
  authDir: string,
  qrFile: string,
  statusFile: string,
  phoneNumber?: string,
  isReconnect = false,
): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  if (state.creds.registered && !isReconnect) {
    fs.writeFileSync(statusFile, 'already_authenticated');
    console.log('already authenticated with WhatsApp');
    console.log('  to re-authenticate, delete store/auth and run again.');
    process.exit(0);
  }

  const { version } = await fetchLatestWaWebVersion({}).catch((err) => {
    logger.warn(
      { err },
      'Failed to fetch latest WA Web version, using default',
    );
    return { version: undefined };
  });
  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal: false,
    logger,
    browser: Browsers.macOS('Chrome'),
  });

  const usePairingCode = !!phoneNumber;

  if (usePairingCode && !state.creds.me) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phoneNumber!);
        console.log(`\npairing code: ${code}\n`);
        console.log('  1. open WhatsApp on your phone');
        console.log('  2. tap Settings > Linked Devices > Link a Device');
        console.log('  3. tap "Link with phone number instead"');
        console.log(`  4. enter this code: ${code}\n`);
        fs.writeFileSync(statusFile, `pairing_code:${code}`);
      } catch (err: any) {
        console.error('Failed to request pairing code:', err.message);
        process.exit(1);
      }
    }, 3000);
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      fs.writeFileSync(qrFile, qr);
      console.log('scan this QR code with WhatsApp:\n');
      console.log('  1. open WhatsApp on your phone');
      console.log('  2. tap Settings > Linked Devices > Link a Device');
      console.log('  3. point your camera at the QR code below\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const reason = (lastDisconnect?.error as any)?.output?.statusCode;

      if (reason === DisconnectReason.loggedOut) {
        fs.writeFileSync(statusFile, 'failed:logged_out');
        console.log('\nLogged out. Delete store/auth and try again.');
        process.exit(1);
      } else if (reason === DisconnectReason.timedOut) {
        fs.writeFileSync(statusFile, 'failed:qr_timeout');
        console.log('\nQR code timed out. Please try again.');
        process.exit(1);
      } else if (reason === 515) {
        console.log('\nstream error (515) after pairing — reconnecting...');
        connectSocket(authDir, qrFile, statusFile, phoneNumber, true);
      } else {
        fs.writeFileSync(statusFile, `failed:${reason || 'unknown'}`);
        console.log('\nConnection failed. Please try again.');
        process.exit(1);
      }
    }

    if (connection === 'open') {
      fs.writeFileSync(statusFile, 'authenticated');
      try {
        fs.unlinkSync(qrFile);
      } catch {}
      console.log('\nauthenticated with WhatsApp');
      console.log('  credentials saved to store/auth/');
      console.log('  you can now start the service.\n');
      setTimeout(() => process.exit(0), 1000);
    }
  });

  sock.ev.on('creds.update', saveCreds);
}

async function authenticate(dataDir: string, args: string[]): Promise<void> {
  const storeDir = path.join(dataDir, 'store');
  const authDir = path.join(storeDir, 'auth');
  const qrFile = path.join(storeDir, 'qr-data.txt');
  const statusFile = path.join(storeDir, 'auth-status.txt');

  fs.mkdirSync(authDir, { recursive: true });

  try {
    fs.unlinkSync(qrFile);
  } catch {}
  try {
    fs.unlinkSync(statusFile);
  } catch {}

  const usePairingCode = args.includes('--pairing-code');
  const phoneIdx = args.indexOf('--phone');
  let phoneNumber = phoneIdx >= 0 ? args[phoneIdx + 1] : undefined;

  if (usePairingCode && !phoneNumber) {
    phoneNumber = await askQuestion(
      'Enter phone number (with country code, no + or spaces): ',
    );
  }

  console.log('starting WhatsApp authentication...\n');
  await connectSocket(authDir, qrFile, statusFile, phoneNumber);
}

function isAuthenticated(dataDir: string): boolean {
  return fs.existsSync(path.join(dataDir, 'store', 'auth', 'creds.json'));
}

export const whatsappAuth: ChannelAuth = {
  name: 'whatsapp',
  isAuthenticated,
  authenticate,
};

// standalone mode: npx tsx src/whatsapp-auth.ts
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('/whatsapp-auth.ts') ||
    process.argv[1].endsWith('/whatsapp-auth.js'));

if (isMain) {
  authenticate('.', process.argv.slice(2)).catch((err) => {
    console.error('Authentication failed:', err.message);
    process.exit(1);
  });
}
