const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");

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

  console.log(`[INFO] service=weather-bot fetching weather for ${city}`);

  const data = await fetchJson(url);
  const weather = data.current_weather;

  if (!weather) {
    throw new Error("Weather data is missing from the API response");
  }

  const message = `Weather in ${city}: ${weather.temperature}°C, wind ${weather.windspeed} km/h, code ${weather.weathercode}`;

  console.log(`[INFO] service=weather-bot ${message}`);
  console.log(message);
}

async function runForever() {
  let isRunning = false;

  const runOnce = async () => {
    if (isRunning) {
      console.log("[INFO] service=weather-bot previous run is still in progress, skipping this tick");
      return;
    }

    isRunning = true;

    try {
      await fetchWeatherOnce();
    } catch (error) {
      console.error(`[ERROR] service=weather-bot ${error.message}`);
    } finally {
      isRunning = false;
    }
  };

  await runOnce();
  setInterval(runOnce, intervalMs);
}

runForever().catch((error) => {
  console.error(`[ERROR] service=weather-bot ${error.message}`);
  process.exitCode = 1;
});