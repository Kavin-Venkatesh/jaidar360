require("dotenv").config();

const twilio = require("twilio");

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

const client = twilio(accountSid, authToken);

async function createMainMenu() {
  try {
    const content = await client.content.v1.contents.create({
      friendlyName: "main_menu",
      language: "en",

      types: {
        "twilio/list-picker": {
          body: "What would you like to do?",
          button: "Choose",

          items: [
            {
              id: "CHECK_IN",
              item: "Check in",
              description: "Record your field check-in"
            },
            {
              id: "NEW_CUSTOMER_VISIT",
              item: "New customer visit",
              description: "Create a new customer visit"
            }
          ]
        }
      }
    });

    console.log("Content created successfully!");
    console.log("Content SID:", content.sid);
    console.log("Friendly name:", content.friendlyName);
  } catch (error) {
    console.error("Failed to create content:");
    console.error(error);
  }
}

createMainMenu();