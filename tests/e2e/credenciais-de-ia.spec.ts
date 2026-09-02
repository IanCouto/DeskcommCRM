/**
 * Jornada: admin cola uma chave de IA e entende o resultado sem ler código.
 * Antes, o card mostrava `auth_failed_401` e a lista de modelos colada por vírgula.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test, expect, type Page } from "@playwright/test";

interface E2ECreds {
  password: string;
  users: Record<string, { email: string } | undefined>;
}

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");

function loadCreds(): E2ECreds {
  if (!fs.existsSync(CREDS_PATH)) {
    execFileSync("npx", ["tsx", "scripts/seed-e2e-credentials.ts"], { stdio: "inherit" });
  }
  return JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as E2ECreds;
}

const creds = loadCreds();

async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(creds.password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/app\//);
}

test.describe("Chaves de acesso à IA", () => {
  test("[P0] chave inválida vira frase legível, e a tela diz onde pegar outra", async ({ page }) => {
    await login(page, creds.users.admin!.email);
    await page.goto("/app/ai/credentials");

    const rotulo = `E2E ${Date.now()}`;
    await page.getByRole("button", { name: /adicionar credencial/i }).first().click();

    // O diálogo ajuda antes de pedir: diz quando usar e onde pegar a chave.
    await expect(page.getByText(/padrão recomendado para conversar/)).toBeVisible();
    await expect(page.getByRole("link", { name: /pegar chave em/i })).toHaveAttribute(
      "href",
      /console\.anthropic\.com/,
    );
    await expect(page.locator("#cred-key")).toHaveAttribute("placeholder", "sk-ant-…");

    await page.locator("#cred-label").fill(rotulo);
    await page.locator("#cred-key").fill("sk-ant-c••••••••••••••••••••••••");
    await page.getByRole("button", { name: /salvar e validar/i }).click();

    const card = page.locator("li", { hasText: rotulo });
    await expect(card).toBeVisible();

    // Resultado da validação em até 15 s (401 com rede; network_error sem).
    await expect(card.getByText(/recusou a chave|Não foi possível falar com o provedor/)).toBeVisible({
      timeout: 15_000,
    });

    // Código cru nunca aparece como texto visível.
    await expect(card.getByText(/^auth_failed_401$|^network_error$/)).toHaveCount(0);

    // Modelos: contagem ou travessão — nunca uma lista colada por vírgula.
    const modelos = await card.locator("dd").first().innerText();
    expect(modelos).toMatch(/^(\d+|—)$/);

    // Limpeza pela própria tela: não está em uso, então o botão está habilitado.
    await card.getByRole("button", { name: /excluir credencial/i }).click();
    await page.getByRole("button", { name: /^remover$/i }).click();
    await expect(card).toHaveCount(0);

    await page.screenshot({ path: ".superpowers/evidence/credenciais-de-ia.png", fullPage: true });
  });
});
