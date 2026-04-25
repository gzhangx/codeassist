import { GoogleGenAI } from "@google/genai";
import 'dotenv/config';
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

// --- 1. CONFIG & API SETUP ---
function getApiKey() {
  try {
    const content = fs.readFileSync('sec.txt', 'utf8');
    const match = content.match(/apiKey:\s*(\S+)/);
    return match ? match[1] : process.env.GEMINI_API_KEY;
  } catch (err) {
    return process.env.GEMINI_API_KEY;
  }
}

const ai = new GoogleGenAI({ apiKey: getApiKey() });
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// --- 2. THE HANDLERS (The Agent's Hands) ---
const handlers = {
  list: (dirPath) => {
    const fullPath = path.resolve(process.cwd(), dirPath);
    if (!fullPath.startsWith(process.cwd())) return "Error: Access denied (outside root).";
    return fs.readdirSync(fullPath).join('\n');
  },
  read: (filePath) => {
    const fullPath = path.resolve(process.cwd(), filePath);
    if (!fullPath.startsWith(process.cwd())) return "Error: Access denied.";
    return fs.readFileSync(fullPath, 'utf8');
  },
  write: (filePath, content) => {
    const fullPath = path.resolve(process.cwd(), filePath);
    if (!fullPath.startsWith(process.cwd())) return "Error: Access denied.";
    fs.writeFileSync(fullPath, content);
    return `Successfully wrote to ${filePath}`;
  },
  execute: (command) => {
    // Only allows execution if user confirms in the loop
    return execSync(command, { encoding: 'utf8', timeout: 5000 });
  }
};

// --- 3. SYSTEM PROMPT ---
const env = {
  os: os.platform(),
  cwd: process.cwd(),
  files: fs.readdirSync(process.cwd()).join(', ')
};

const systemInstruction = `
You are a Local Dev Agent. OS: ${env.os}. Dir: ${env.cwd}.
Files: ${env.files}

To interact with the system, use these exact XML tags in your response:
1. List files: <list>path/to/dir</list>
2. Read file: <read>path/to/file</read>
3. Write file: <write path="name.js">content here</write>
4. Run Node/Shell: <execute>command</execute>

RULES:
- Stay inside ${env.cwd}.
- For <execute>, you MUST explain what the command does first.
- Only one action per message.
`;

// --- 4. THE CHAT ENGINE ---
async function startAgent() {
  const model = ai.getGenerativeModel({ model: "gemini-3-flash-preview" });
  const chat = model.startChat({
    history: [
      { role: "user", parts: [{ text: systemInstruction }] },
      { role: "model", parts: [{ text: "Agent initialized. I can read, write, list, and execute commands in your current directory. How can I help?" }] }
    ],
  });

  console.log("\x1b[32m%s\x1b[0m", "--- Local Agent Ready ---");

  const processStep = async (userInput) => {
    try {
      const result = await chat.sendMessage(userInput);
      const response = result.response.text();
      console.log(`\n\x1b[35mGemini:\x1b[0m\n${response}\n`);

      // PARSING LOGIC
      if (response.includes('<list>')) {
        const dir = response.match(/<list>(.*?)<\/list>/)[1];
        const data = handlers.list(dir);
        return processStep(`Output of list ${dir}:\n${data}`);
      } 
      
      if (response.includes('<read>')) {
        const file = response.match(/<read>(.*?)<\/read>/)[1];
        const data = handlers.read(file);
        return processStep(`Content of ${file}:\n${data}`);
      }

      if (response.includes('<write')) {
        const filePath = response.match(/path="(.*?)"/)[1];
        const content = response.match(/<write.*?>(.*?)<\/write>/s)[1];
        const status = handlers.write(filePath, content);
        return processStep(status);
      }

      if (response.includes('<execute>')) {
        const cmd = response.match(/<execute>(.*?)<\/execute>/)[1];
        rl.question(`\x1b[33mGrant permission to run: [${cmd}]? (y/n): \x1b[0m`, (ans) => {
          if (ans.toLowerCase() === 'y') {
            try {
              const output = handlers.execute(cmd);
              processStep(`Execution Output:\n${output}`);
            } catch (e) {
              processStep(`Execution Error: ${e.message}`);
            }
          } else {
            processStep("User denied execution permission.");
          }
        });
        return; // Wait for user input
      }

      // If no tags, wait for user's next prompt
      askNext();
    } catch (err) {
      console.error("Error:", err.message);
      askNext();
    }
  };

  const askNext = () => {
    rl.question("\x1b[36mYou: \x1b[0m", (input) => {
      if (input.toLowerCase() === 'exit') return rl.close();
      processStep(input);
    });
  };

  askNext();
}

startAgent();