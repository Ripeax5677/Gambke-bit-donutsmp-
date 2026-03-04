const bedrock = require('bedrock-protocol');
const readline = require('readline');
const { Authenticator } = require('prismarine-auth');
const fetch = require('node-fetch');

const MC_HOST = process.env.MC_HOST || 'donutsmp.net';
const MC_PORT = parseInt(process.env.MC_PORT) || 19132;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK || '';

const greetedPlayers = new Set();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

// === Discord Embed Funktion ===
function sendDiscordLog(user, botWins, secretAmount) {
  if (!DISCORD_WEBHOOK) return;
  const first3 = user.slice(0, 3);
  const outcome = botWins ? 'Bot gewinnt ❌' : 'User gewinnt ✅';
  const embed = {
    embeds: [{
      title: `🎲 Gamble Result`,
      description: `${outcome}\nGambler: ${first3}...\nSecret Amount: ${secretAmount}`,
      color: botWins ? 0xff0000 : 0x00ff00,
      timestamp: new Date()
    }]
  };
  fetch(DISCORD_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(embed)
  }).catch(err => console.error('Webhook Fehler:', err.message));
}

// === Device Code Login ===
async function loginDeviceCode() {
  const auth = new Authenticator();
  const deviceCode = await auth.getDeviceCode();
  console.log(`Bitte folgenden Code in deinem Browser eingeben: ${deviceCode.user_code}`);
  console.log(`Gehe zu: ${deviceCode.verification_uri}`);
  const account = await auth.deviceCode(deviceCode);
  console.log(`Erfolgreich eingeloggt: ${account.username}`);
  return account;
}

// === Bot Erstellung ===
async function createBot() {
  const account = await loginDeviceCode();

  console.log('Starte Bedrock Bot...');
  const client = bedrock.createClient({
    host: MC_HOST,
    port: MC_PORT,
    username: account.username,
    xbox: {
      userHash: account.xuid,
      accessToken: account.access_token
    }
  });

  client._rl = rl;

  // Konsoleninput
  rl.on('line', (line) => {
    if (line.trim().length > 0) client.send('text', { message: line });
  });

  // Spamfilter für Konsole
  const originalLog = console.log;
  console.log = (...args) => {
    if (args[0] && typeof args[0] === 'string') {
      const msg = args[0].toLowerCase();
      if (msg.includes('chunk') || msg.includes('unloaded') || msg.includes('udid') || msg.includes('rtc')) return;
    }
    originalLog(...args);
  };

  // === Bot Events ===
  client.on('connect', () => console.log('Bot verbunden!'));
  client.on('spawn', () => {
    console.log('Bot gespawnt');
    if (!client._interval) {
      client._interval = setInterval(() => {
        let nearest = null;
        let minDist = Infinity;
        for (const id in client.entities) {
          const e = client.entities[id];
          if (!e || !e.username) continue;
          const dx = e.position.x - client.position.x;
          const dy = e.position.y - client.position.y;
          const dz = e.position.z - client.position.z;
          const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
          if (dist < minDist) { minDist = dist; nearest = e; }
        }
        if (nearest && minDist < 10 && !greetedPlayers.has(nearest.username)) {
          const greetings = ['Hey wsp', 'hey ready paar randoms'];
          const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)];
          client.send('text', { message: randomGreeting });
          greetedPlayers.add(nearest.username);
          setTimeout(() => greetedPlayers.delete(nearest.username), 120000);
        }
      }, 1000);
    }
  });

  // === Chat & Gamble ===
  client.on('text', (packet) => {
    const message = packet.message;
    const lowerMsg = message.toLowerCase();
    if (lowerMsg.includes('chunk') || message.length < 2) return;
    if (!lowerMsg.includes('authenticating') && !lowerMsg.includes('loading')) console.log('Nachricht:', message);

    if (lowerMsg.includes('payed') || lowerMsg.includes('paid')) {
      const parts = message.split(/\s+/);
      const payIndex = parts.findIndex(p => ['payed','paid'].includes(p.toLowerCase()));
      let user = '';
      if (payIndex !== -1 && payIndex > 0) user = parts[payIndex - 1].replace(/[^a-zA-Z0-9_.]/g, '');
      if (user) {
        const roll = Math.floor(Math.random() * 100) + 1;
        const botWins = roll <= 55;
        const secretAmount = Math.floor(Math.random() * 1000) + 100;
        sendDiscordLog(user, botWins, secretAmount);
        if (!botWins) {
          client.send('text', { message: `/pay ${user} ${secretAmount}` });
          console.log(`[Gamble] ${user} gewinnt ${secretAmount}`);
        } else {
          console.log(`[Gamble] Bot gewinnt gegen ${user}`);
        }
      }
    }
  });

  client.on('error', (err) => console.error('Fehler:', err.message));
  client.on('kicked', (packet) => {
    console.log('Gekickt:', packet.reason, 'Rejoin in 3s...');
    cleanup(client);
    setTimeout(createBot, 3000);
  });
  client.on('end', () => {
    console.log('Verbindung verloren. Rejoin in 3s...');
    cleanup(client);
    setTimeout(createBot, 3000);
  });

  return client;
}

function cleanup(client) {
  if (client._rl) { client._rl.close(); client._rl = null; }
  if (client._interval) { clearInterval(client._interval); client._interval = null; }
  try { client.close(); } catch(e) {}
}

// Starte Bot
createBot();
