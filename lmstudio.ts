import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

const LM_STUDIO_URL = 'http://127.0.0.1:1234/v1/chat/completions';
const MODEL = 'local-model';

const rootDir = path.resolve(process.argv[2] || process.cwd());
if (!fs.existsSync(rootDir)) {
  console.error(`Error: directory not found: ${rootDir}`);
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// --- HANDLERS ---
const handlers = {
  list: (dirPath: string): string => {
    const fullPath = path.resolve(rootDir, dirPath);
    if (!fullPath.startsWith(rootDir)) return "Error: Access denied.";
    return fs.readdirSync(fullPath).join('\n');
  },
  read: (filePath: string): string => {
    const fullPath = path.resolve(rootDir, filePath);
    if (!fullPath.startsWith(rootDir)) return "Error: Access denied.";
    return fs.readFileSync(fullPath, 'utf8');
  },
  write: (filePath: string, content: string): string => {
    const fullPath = path.resolve(rootDir, filePath);
    if (!fullPath.startsWith(rootDir)) return "Error: Access denied.";
    fs.writeFileSync(fullPath, content);
    return `Successfully wrote to ${filePath}`;
  },
  execute: (command: string): string => {
    return execSync(command, { encoding: 'utf8', timeout: 10000 });
  }
};

// --- SYSTEM SETUP ---
const env = {
  os: `${os.platform()} ${os.release()}`,
  cwd: rootDir,
  files: fs.readdirSync(rootDir).join(', ')
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

type Message = { role: 'system' | 'user' | 'assistant'; content: string };

async function sendMessage(history: Message[]): Promise<string> {
  const res = await fetch(LM_STUDIO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages: history, temperature: 0.7 }),
  });
  if (!res.ok) throw new Error(`LM Studio error: ${res.status} ${await res.text()}`);
  const data: any = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

async function startAgent() {
  const history: Message[] = [
    { role: 'system', content: systemInstruction },
  ];

  console.log("\x1b[32m%s\x1b[0m", `--- LM Studio Agent Active (root: ${rootDir}) ---`);

  const processStep = async (userInput: string): Promise<void> => {
    history.push({ role: 'user', content: userInput });
    try {
      const startTime = Date.now();
      const response = await sendMessage(history);
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      history.push({ role: 'assistant', content: response });

      console.log(`\x1b[90mwaiting ... ${duration}s\x1b[0m`);
      console.log(`\x1b[33mPreview: ${response.substring(0, 60).replace(/\n/g, ' ')}...\x1b[0m`);
      console.log(`\n\x1b[35mLM Studio:\x1b[0m\n${response}\n`);

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
