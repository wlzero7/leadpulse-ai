import fs from "node:fs";
import path from "node:path";
import git from "isomorphic-git";

async function runGitAutomation() {
  console.log("==================================================================");
  console.log("📦 [Git Automation] Inicializando e sincronizando repositório Git...");
  console.log("==================================================================");

  const dir = process.cwd();
  const repoUrl = "https://github.com/leadpulse-ai/leadpulse-ai.git";

  try {
    // 1. Inicializa o repositório Git (.git) se ainda não existir
    const gitDirExists = fs.existsSync(path.join(dir, ".git"));
    if (!gitDirExists) {
      await git.init({ fs, dir, defaultBranch: "main" });
      console.log("✅ Repositório Git local inicializado (branch: main).");
    } else {
      console.log("ℹ️  Repositório Git já existente localmente.");
    }

    // 2. Configura o remote 'origin'
    const remotes = await git.listRemotes({ fs, dir });
    const hasOrigin = remotes.some((r) => r.remote === "origin");

    if (!hasOrigin) {
      await git.addRemote({
        fs,
        dir,
        remote: "origin",
        url: repoUrl,
      });
      console.log(`✅ Remote origin configurado para: ${repoUrl}`);
    } else {
      console.log(`ℹ️  Remote origin já vinculado a: ${repoUrl}`);
    }

    // 3. Adiciona arquivos ao stage (respeitando .gitignore)
    console.log("📂 Rastreando e adicionando arquivos ao Git index...");
    
    // Lista de arquivos rastreados
    const statusMatrix = await git.statusMatrix({ fs, dir });
    for (const [filepath, head, workdir, stage] of statusMatrix) {
      // Ignora arquivos no .gitignore
      if (workdir === 0) {
        // Arquivo deletado
        await git.remove({ fs, dir, filepath });
      } else if (workdir !== stage) {
        // Arquivo novo ou modificado
        await git.add({ fs, dir, filepath });
      }
    }
    console.log(`✅ ${statusMatrix.length} arquivos processados e adicionados ao stage.`);

    // 4. Cria o commit com metadados oficiais do projeto
    const sha = await git.commit({
      fs,
      dir,
      message: "feat: complete LeadPulse AI platform with B2B landing page, cognitive AI and cloud configs",
      author: {
        name: "LeadPulse AI Architect",
        email: "leadpulseai.official@gmail.com",
      },
    });

    console.log(`🎉 Commit criado com sucesso! SHA: ${sha}`);
    console.log(`📌 Branch: main`);
    console.log(`🌐 Repositório Remoto: ${repoUrl}`);

    console.log("\n==================================================================");
    console.log("✅ [Git Automation] Repositório sincronizado e pronto para push!");
    console.log("==================================================================");
  } catch (error) {
    console.error("❌ Erro durante a automação Git:", error);
  }
}

runGitAutomation();
