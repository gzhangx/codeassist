import { GoogleGenAI } from "@google/genai";
import 'dotenv/config';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

// --- CONFIG & API SETUP ---
function getApiKey(): string {
  try {
    const content = fs.readFileSync('sec.txt', 'utf8');
    const match = content.match(/apiKey:\s*(\S+)/);
    return match ? match[1] : (process.env.GEMINI_API_KEY || "");
  } catch {
    return process.env.GEMINI_API_KEY || "";
  }
}

const client = new GoogleGenAI({ apiKey: getApiKey() });
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// --- HANDLERS ---
const handlers = {
  list: (dirPath: string): string => {
    const fullPath = path.resolve(process.cwd(), dirPath);
    if (!fullPath.startsWith(process.cwd())) return "Error: Access denied.";
    return fs.readdirSync(fullPath).join('\n');
  },
  read: (filePath: string): string => {
    const fullPath = path.resolve(process.cwd(), filePath);
    if (!fullPath.startsWith(process.cwd())) return "Error: Access denied.";
    return fs.readFileSync(fullPath, 'utf8');
  },
  write: (filePath: string, content: string): string => {
    const fullPath = path.resolve(process.cwd(), filePath);
    if (!fullPath.startsWith(process.cwd())) return "Error: Access denied.";
    fs.writeFileSync(fullPath, content);
    return `Successfully wrote to ${filePath}`;
  },
  execute: (command: string): string => {
    // Executes shell command and returns output
    return execSync(command, { encoding: 'utf8', timeout: 10000 });
  }
};

// --- SYSTEM SETUP ---
const env = {
  os: `${os.platform()} ${os.release()}`,
  cwd: process.cwd(),
  files: fs.readdirSync(process.cwd()).join(', ')
};

const systemInstruction = `
You are a Local Dev Agent. OS: ${env.os}. Dir: ${env.cwd}.
Files: ${env.files}

COMMAND PROTOCOL (Use these tags to act):
1. List: <list>path</list>
2. Read: <read>path</read>
3. Write: <write path="filename">content</write>
4. Execute: <execute>command</execute>

RULES:
- Only operate inside ${env.cwd}.
- For <execute>, explain the command first.
- Only one action per message.
`;

async function startAgent() {
  const modelName = "gemini-3-flash-preview";

  // In @google/genai, history is managed within the session
  const chat = client.chats.create({
    model: modelName,
    history: [
      { role: "user", parts: [{ text: systemInstruction }] },
      { role: "model", parts: [{ text: "Agent initialized using @google/genai. I am ready to manage your local files." }] }
    ],
  })  

  console.log("\x1b[32m%s\x1b[0m", "--- Unified SDK Agent Active ---");

  const processStep = async (userInput: string): Promise<void> => {
    try {
      const result = await chat.sendMessage({        
        message: userInput,
      });
      const response = result.text || '';
      console.log(`\n\x1b[35mGemini:\x1b[0m\n${response}\n`);

      // --- TAG PARSING ---
      
      // Handle List
      if (response.includes('<list>')) {
        const dir = response.match(/<list>(.*?)<\/list>/)?.[1] || ".";
        const data = handlers.list(dir);
        return processStep(`Output of list ${dir}:\n${data}`);
      } 
      
      // Handle Read
      if (response.includes('<read>')) {
        const file = response.match(/<read>(.*?)<\/read>/)?.[1];
        if (file) {
          const data = handlers.read(file);
          return processStep(`Content of ${file}:\n${data}`);
        }
      }

      // Handle Write
      if (response.includes('<write')) {
        const filePath = response.match(/path="(.*?)"/)?.[1];
        const content = response.match(/<write.*?>(.*?)<\/write>/s)?.[1];
        if (filePath && content !== undefined) {
          const status = handlers.write(filePath, content);
          return processStep(status);
        }
      }

      // Handle Execute
      if (response.includes('<execute>')) {
        const cmd = response.match(/<execute>(.*?)<\/execute>/)?.[1];
        if (cmd) {
          rl.question(`\x1b[33mGrant permission to run: [${cmd}]? (y/n): \x1b[0m`, (ans) => {
            if (ans.toLowerCase() === 'y') {
              try {
                const output = handlers.execute(cmd);
                processStep(`Execution Output:\n${output}`);
              } catch (e: any) {
                processStep(`Execution Error: ${e.message}`);
              }
            } else {
              processStep("User denied execution permission.");
            }
          });
          return;
        }
      }

      askNext();
    } catch (err: any) {
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