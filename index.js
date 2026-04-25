import { GoogleGenAI } from "@google/genai";
import 'dotenv/config';
import readline from 'readline';

import fs from 'fs';

// 1. Function to parse sec.txt
function getApiKey() {
  try {
    const content = fs.readFileSync('sec.txt', 'utf8');
    // Uses regex to find the string after "apiKey:"
    const match = content.match(/apiKey:\s*(\S+)/);
    
    if (!match || !match[1]) {
      throw new Error("Could not find 'apiKey:' in sec.txt");
    }
    return match[1];
  } catch (err) {
      if (process.env.GEMINI_API_KEY) {
          return process.env.GEMINI_API_KEY;
      }
    console.error("Error reading sec.txt:", err.message);
    process.exit(1);
  }
}

// 1. Initialize the SDK
const ai = new GoogleGenAI({
  apiKey: getApiKey(),
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function startChat() {
  // 2. Select the model (Gemini 3 Flash is great for speed and code)
  const model = "gemini-3-flash-preview";
  
  console.log("\x1b[32m%s\x1b[0m", "--- Gemini Chat Session Started ---");
  console.log("Type your prompt (e.g., 'Write a Python script to scrape a website') or 'exit' to quit.\n");

  const askQuestion = () => {
    rl.question("\x1b[36mYou: \x1b[0m", async (input) => {
      if (input.toLowerCase() === 'exit') {
        console.log("Goodbye!");
        rl.close();
        return;
      }

      try {
        // 3. Generate content
        const response = await ai.models.generateContent({
          model: model,
          contents: [{ role: "user", parts: [{ text: input }] }],
        });

        const text = response.text;
        console.log("\n\x1b[35mGemini:\x1b[0m");
        console.log(text);
        console.log("\n---");

      } catch (error) {
        console.error("\x1b[31mError:\x1b[0m", error.message);
      }

      askQuestion(); // Loop for continuous chat
    });
  };

  askQuestion();
}

startChat();