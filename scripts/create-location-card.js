require("dotenv").config();

const twilio = require("twilio");

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

async function createLocationCard() {
  try {
    const content = await client.content.v1.contents.create({
      friendlyName: "check_in_location",
      language: "en",

      types: {
        "twilio/card": {
          title: "Check in",

          body: "Share your current location to record your field visit.",

          media: [
            "https://jaidar-whatsapp-assets.s3.ap-south-1.amazonaws.com/whatsapp/location.png"
          ],

          actions: [
            {
              type: "URL",
              title: "Share location",
              url: "https://example.com/geo/capture?token={{1}}"
            }
          ]
        }
      },

      variables: {
        "1": "sample-token"
      }
    });

    console.log("Location card created");
    console.log("Content SID:", content.sid);
  } catch (error) {
    console.error("Failed to create location card");
    console.error(error);
  }
}

createLocationCard();