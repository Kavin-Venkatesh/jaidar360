const {
  processCapturedLocation,
} = require("../services/location.service");

function getGeoCapture(req, res) {
  const token = String(req.query.token || "").trim();

  if (!token) {
    return res.status(400).send(`
      <!doctype html>
      <html>
        <body>
          <h2>Invalid location link</h2>
          <p>The location token is missing.</p>
        </body>
      </html>
    `);
  }

  const escapedToken = token
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");

  res.type("html").send(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0"
        />
        <title>JAIDAR - Share Location</title>

        <style>
          body {
            font-family: Arial, sans-serif;
            background: #f5f7fa;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
          }

          .card {
            width: 100%;
            max-width: 420px;
            background: white;
            padding: 28px;
            border-radius: 16px;
            box-shadow: 0 8px 30px rgba(0,0,0,0.08);
            text-align: center;
          }

          button {
            width: 100%;
            padding: 14px;
            border: 0;
            border-radius: 10px;
            background: #128c7e;
            color: white;
            font-size: 16px;
            cursor: pointer;
          }

          #status {
            margin: 20px 0;
            line-height: 1.5;
          }

          .success {
            color: #15803d;
          }

          .error {
            color: #dc2626;
          }

          a {
            display: inline-block;
            margin-top: 15px;
          }
        </style>
      </head>

      <body>
        <div class="card">
          <h2>Share your location</h2>

          <div id="status">
            Tap the button below to share your current location.
          </div>

          <button id="shareLocation">
            Share Location
          </button>
        </div>

        <script>
          const token = '${escapedToken}';

          const statusElement =
            document.getElementById("status");

          const button =
            document.getElementById("shareLocation");

          function setStatus(message, type = "") {
            statusElement.textContent = message;
            statusElement.className = type;
          }

          async function submitLocation(position) {
            const payload = {
              token,
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
              capturedAt: new Date().toISOString(),
              source: "browser",
            };

            setStatus("Saving your location...");

            const response = await fetch("/geo/capture", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(payload),
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
              throw new Error(
                result.message ||
                result.error ||
                "Unable to save location"
              );
            }

            setStatus(
              "Location captured successfully.",
              "success"
            );

            if (result.mapsUrl) {
              const link = document.createElement("a");

              link.href = result.mapsUrl;
              link.target = "_blank";
              link.rel = "noopener noreferrer";
              link.textContent = "View captured location";

              statusElement.appendChild(
                document.createElement("br")
              );

              statusElement.appendChild(link);
            }

            button.disabled = true;
          }

          function captureLocation() {
            if (!navigator.geolocation) {
              setStatus(
                "Geolocation is not supported by this browser.",
                "error"
              );
              return;
            }

            setStatus("Requesting your location...");

            navigator.geolocation.getCurrentPosition(
              async (position) => {
                try {
                  await submitLocation(position);
                } catch (error) {
                  console.error(error);

                  setStatus(
                    error.message ||
                    "Failed to save your location.",
                    "error"
                  );
                }
              },
              (error) => {
                console.error(error);

                let message =
                  "Unable to access your location.";

                if (error.code === 1) {
                  message =
                    "Location permission was denied. Please allow location access and try again.";
                } else if (error.code === 2) {
                  message =
                    "Your location could not be determined.";
                } else if (error.code === 3) {
                  message =
                    "Location request timed out. Please try again.";
                }

                setStatus(message, "error");
              },
              {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 0,
              }
            );
          }

          button.addEventListener(
            "click",
            captureLocation
          );
        </script>
      </body>
    </html>
  `);
}

async function postGeoCapture(req, res) {
  try {
    const result =
      await processCapturedLocation({
        token: req.body.token,
        latitude: req.body.latitude,
        longitude: req.body.longitude,
        accuracy: req.body.accuracy,
        capturedAt: req.body.capturedAt,
        source: req.body.source || "browser",
      });

    return res.status(200).json(result);
  } catch (error) {
    console.error(
      "Location capture failed:",
      error
    );

    return res.status(400).json({
      success: false,
      message: error.message || "Location capture failed",
    });
  }
}

module.exports = {
  getGeoCapture,
  postGeoCapture,
};