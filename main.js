const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const { Client, GatewayIntentBits, EmbedBuilder, Events } = require("discord.js");

function getTimestamp() {
  return new Date().toLocaleString("ru-RU");
}

function loadLocalEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) continue;
    const separatorIndex = trimmedLine.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmedLine.slice(0, separatorIndex).trim();
    const value = trimmedLine.slice(separatorIndex + 1).trim();
    if (key && !process.env[key]) process.env[key] = value;
  }
}

loadLocalEnv(path.join(__dirname, ".env"));

const city = process.env.CITY || "Tallinn";
const latitude = process.env.LATITUDE || "59.4370";
const longitude = process.env.LONGITUDE || "24.7536";
const discordToken = process.env.DISCORD_TOKEN;
const discordChannelId = process.env.DISCORD_CHANNEL_ID;

const discordClient = new Client({ intents: [GatewayIntentBits.Guilds] });

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      let body = "";
      response.on("data", (chunk) => body += chunk);
      response.on("end", () => {
        if (response.statusCode >= 400) return reject(new Error(`HTTP ${response.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

async function fetchAndSend() {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", latitude);
  url.searchParams.set("longitude", longitude);
  url.searchParams.set("current_weather", "true");
  url.searchParams.set("timezone", "auto");

  console.log(`[${getTimestamp()}] [INFO] service=weather-bot fetching weather for ${city}`);
  
  const data = await fetchJson(url);
  const weather = data.current_weather;
  if (!weather) throw new Error("Weather data missing");

  const logMsg = `Weather in ${city}: ${weather.temperature}°C, wind ${weather.windspeed} km/h`;
  console.log(`[${getTimestamp()}] [INFO] service=weather-bot ${logMsg}`);

  if (discordToken && discordChannelId) {
    const channel = await discordClient.channels.fetch(discordChannelId);
    if (channel?.isTextBased()) {
      const embed = new EmbedBuilder()
        .setTitle(`🌤️ Weather in ${city}`)
        .addFields(
          { name: "Temperature", value: `${weather.temperature}°C`, inline: true },
          { name: "Wind speed", value: `${weather.windspeed} km/h`, inline: true },
          { name: "Updated", value: getTimestamp() }
        )
        .setColor(0x0099ff);

      await channel.send({ embeds: [embed] });
      console.log(`[${getTimestamp()}] [INFO] Message sent to Discord`);
    }
  }
}

async function main() {
  if (!discordToken || !discordChannelId) {
    throw new Error("Missing Discord credentials in Environment Variables");
  }

  const readyPromise = new Promise(resolve => discordClient.once(Events.ClientReady, resolve));
  await discordClient.login(discordToken);
  await readyPromise;
  
  console.log(`[${getTimestamp()}] [INFO] service=weather-bot Discord client connected`);

  try {
    await fetchAndSend();
  } finally {
    discordClient.destroy();
    console.log(`[${getTimestamp()}] [INFO] service=weather-bot Task finished. Exiting.`);
  }
}

main().then(() => {
  process.exit(0);
}).catch(err => {
  console.error(`[${getTimestamp()}] [ERROR] service=weather-bot ${err.message}`);
  process.exit(1);
});