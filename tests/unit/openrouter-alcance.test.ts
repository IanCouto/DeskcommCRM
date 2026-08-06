/**
 * Invariante de ALCANCE: o que a `OPENROUTER_API_KEY` roteia — e o que ela não
 * roteia.
 *
 * Por que este arquivo existe: o `.env.example` afirma ao self-hoster quais
 * caminhos passam a usar a OpenRouter quando ele preenche a chave. Afirmação em
 * comentário não se defende sozinha — a primeira pessoa que ligar o resolver a
 * um caminho novo não vai lembrar de reescrever o aviso, e o usuário decide a
 * configuração da instalação lendo justamente esse aviso.
 *
 * O alcance real hoje, medido: `resolveLanguageModel()` é chamado por
 * `ai-sentiment-worker` (classificação de sentimento) e `ai-response-worker`
 * (bot de resposta). NENHUM dos dois passa `tools` ao SDK. O agente do CRM, que
 * opera por ferramentas, roda por outro caminho — `lib/agent-engine/edge/llm/
 * providers.ts` (credencial BYOK por organização) e `buildModel()` em
 * `lib/ai/runtime/agent.ts` —, e nenhum deles conhece a OpenRouter.
 *
 * Isso importa porque muda QUAL risco o usuário corre. Um modelo sem tool
 * calling sólido é catastrófico num turno com ferramentas (responde texto
 * plausível e nunca cria o lead nem move o card) e é inofensivo numa
 * classificação de sentimento. Enquanto a OpenRouter não alcançar o primeiro
 * grupo, o aviso não deve assustar com ele; no dia em que alcançar, o aviso
 * PRECISA assustar — e este teste é quem obriga a decidir isso conscientemente.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = resolve(__dirname, "../..");

/** Arquivos de produção que importam o resolver (exclui testes e o próprio módulo). */
function chamadoresDoResolver(): string[] {
  const saida = execFileSync(
    "git",
    ["grep", "-l", "resolveLanguageModel", "--", "lib", "workers", "app", "scripts"],
    { cwd: RAIZ, encoding: "utf8" },
  );
  return saida
    .split("\n")
    .filter(Boolean)
    .filter((f) => !f.includes(".test.") && f !== "lib/ai/gateway.ts" && f !== "lib/env.ts");
}

describe("alcance da OPENROUTER_API_KEY", () => {
  it("o resolver tem chamadores — senão o invariante estaria passando por vacuidade", () => {
    // Sem esta asserção, apagar o resolver deixaria o teste abaixo verde e o
    // aviso do .env.example desprotegido.
    expect(chamadoresDoResolver().length).toBeGreaterThan(0);
  });

  it("nenhum caminho roteado pela OpenRouter passa FERRAMENTAS ao modelo", () => {
    const comFerramentas = chamadoresDoResolver().filter((arquivo) =>
      /\btools\s*:/.test(readFileSync(resolve(RAIZ, arquivo), "utf8")),
    );

    expect(
      comFerramentas,
      comFerramentas.length
        ? `${comFerramentas.join(", ")} passa(m) ferramentas ao modelo E resolve(m) pela OpenRouter. ` +
            "O aviso sobre tool calling em .env.example / .env.hostgator.example foi escrito quando " +
            "isso NÃO acontecia e agora está desatualizado: reescreva-o antes de liberar este caminho."
        : undefined,
    ).toEqual([]);
  });

  it("o agente com ferramentas continua fora do alcance da OpenRouter", () => {
    // Os dois runtimes que passam `tools` montam o modelo por conta própria.
    // Se um deles passar a conhecer a OpenRouter, o aviso muda de natureza.
    for (const arquivo of ["lib/agent-engine/edge/llm/providers.ts", "lib/ai/runtime/agent.ts"]) {
      expect(readFileSync(resolve(RAIZ, arquivo), "utf8").toLowerCase()).not.toContain("openrouter");
    }
  });
});
