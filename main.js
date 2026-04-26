const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");

const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");

function getTimestamp() {
  return new Date().toLocaleString("ru-RU");
}

// Инициализация Discord клиента
const discordClient = new Client({ intents: [GatewayIntentBits.Guilds] });
let isDiscordReady = false;

discordClient.on("ready", () => {
  console.log(`[${getTimestamp()}] [INFO] Discord bot logged in as ${discordClient.user.tag}`);
  isDiscordReady = true;
});

discordClient.on("error", (error) => {
  console.error(`[${getTimestamp()}] [ERROR] Discord client error: ${error.message}`);
});

// Подключение к Discord
const discordToken = process.env.DISCORD_TOKEN;
const discordChannelId = process.env.DISCORD_CHANNEL_ID;

if (discordToken && discordChannelId) {
  discordClient.login(discordToken).catch((error) => {
    console.error(`[${getTimestamp()}] [ERROR] Failed to login to Discord: ${error.message}`);
  });
}

function loadLocalEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const value = trimmedLine.slice(separatorIndex + 1).trim();

    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadLocalEnv(path.join(__dirname, ".env"));

const city = process.env.CITY || "Tallinn";
const latitude = process.env.LATITUDE || "59.4370";
const longitude = process.env.LONGITUDE || "24.7536";
const intervalMs = 60 * 1000;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        let body = "";

        response.on("data", (chunk) => {
          body += chunk;
        });

        response.on("end", () => {
          if (response.statusCode && response.statusCode >= 400) {
            reject(new Error(`HTTP ${response.statusCode}: ${body}`));
            return;
          }

          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error(`Invalid JSON response: ${error.message}`));
          }
        });
      })
      .on("error", reject);
  });
}

async function fetchWeatherOnce() {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", latitude);
  url.searchParams.set("longitude", longitude);
  url.searchParams.set("current_weather", "true");
  url.searchParams.set("timezone", "auto");

  console.log(`[${getTimestamp()}] [INFO] service=weather-bot fetching weather for ${city}`);

  const data = await fetchJson(url);
  const weather = data.current_weather;

  if (!weather) {
    throw new Error("Weather data is missing from the API response");
  }

  const message = `Weather in ${city}: ${weather.temperature}°C, wind ${weather.windspeed} km/h, code ${weather.weathercode}`;

  console.log(`[${getTimestamp()}] [INFO] service=weather-bot ${message}`);
  console.log(message);

  // Отправка на Discord
  if (isDiscordReady && discordChannelId) {
    try {
      const channel = await discordClient.channels.fetch(discordChannelId);
      if (channel && channel.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle(`🌤️ Weather in ${city}`)
          .addFields(
            { name: "Temperature", value: `${weather.temperature}°C`, inline: true },
            { name: "Wind Speed", value: `${weather.windspeed} km/h`, inline: true },
            { name: "Weather Code", value: `${weather.weathercode}`, inline: true },
            { name: "Updated", value: getTimestamp(), inline: false }
          )
          .setColor(0x0099ff)
          .setTimestamp();

        await channel.send({ embeds: [embed] });
        console.log(`[${getTimestamp()}] [INFO] Message sent to Discord`);
      }
    } catch (error) {
      console.error(`[${getTimestamp()}] [ERROR] Failed to send Discord message: ${error.message}`);
    }
  }
}

async function runForever() {
  // Ждем, пока бот подключится к Discord (если токен задан)
  if (discordToken && discordChannelId) {
    console.log(`[${getTimestamp()}] [INFO] Waiting for Discord bot to be ready...`);
    await new Promise((resolve) => {
      if (isDiscordReady) {
        resolve();
      } else {
        discordClient.once("ready", resolve);
      }
    });
  }

  let isRunning = false;

  const runOnce = async () => {
    if (isRunning) {
      console.log(`[${getTimestamp()}] [INFO] service=weather-bot previous run is still in progress, skipping this tick`);
      return;
    }

    isRunning = true;

    try {
      await fetchWeatherOnce();
    } catch (error) {
      console.error(`[${getTimestamp()}] [ERROR] service=weather-bot ${error.message}`);
    } finally {
      isRunning = false;
    }
  };

  await runOnce();
  setInterval(runOnce, intervalMs);
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log(`[${getTimestamp()}] [INFO] Shutting down gracefully...`);
  if (isDiscordReady) {
    await discordClient.destroy();
  }
  process.exit(0);
});

runForever().catch((error) => {
  console.error(`[${getTimestamp()}] [ERROR] service=weather-bot ${error.message}`);
  if (isDiscordReady) {
    discordClient.destroy();
  }
  process.exitCode = 1;
});