import { describe, expect, it } from "vitest";

import { modelCapabilities } from "@/lib/agent-engine/edge/llm/capabilities";
import { decidirBinding } from "@/lib/ai/pontos/resolver";
import { enxergaImagem } from "@/lib/ai/pontos/capacidade-em-vigor";

/**
 * A TELA E O MOTOR RESPONDEM A MESMA COISA SOBRE "ESTE MODELO ENXERGA IMAGEM?".
 *
 * ═══ O defeito, medido numa instalação real ═════════════════════════════════
 *
 * Havia duas verdades. O motor perguntava a `modelCapabilities()`; a tela lia
 * `ai_models.supports_vision`. Na instalação medida a coluna estava `false`
 * para TODOS os modelos do catálogo, então a tela avisava
 *
 *     "gpt-5.6-sol não enxerga imagens. Fotos e comprovantes que o cliente
 *      enviar vão ser ignorados pelo agente."
 *
 * enquanto o motor mandava a imagem e ela era lida — na MESMA instalação, o
 * print que o cliente enviou virou descrição correta.
 *
 * ⚠️ Aviso falso é pior que aviso nenhum: empurra quem opera a trocar um modelo
 * que funciona, ou a desistir de um recurso que está no ar.
 */

const CATALOGO_ERRADO = false; // o que a coluna dizia na instalação medida

describe("a capacidade em vigor é a do motor", () => {
  it("gpt-5.6-sol enxerga, mesmo com a coluna dizendo que não", () => {
    expect(enxergaImagem({ provider: "openai", modelId: "gpt-5.6-sol", doCatalogo: CATALOGO_ERRADO })).toBe(true);
  });

  it("claude-sonnet-5 enxerga, mesmo com a coluna dizendo que não", () => {
    expect(enxergaImagem({ provider: "anthropic", modelId: "claude-sonnet-5", doCatalogo: CATALOGO_ERRADO })).toBe(true);
  });

  it("a resposta é IDÊNTICA à do motor — é a mesma pergunta", () => {
    // O caso que amarra as duas fontes: se alguém mudar o registro do motor
    // amanhã, a tela muda junto. Sem isto, o conserto seria uma cópia que
    // envelhece — que é exatamente o defeito que ele veio resolver.
    for (const [p, m] of [
      ["openai", "gpt-5.6-sol"],
      ["anthropic", "claude-sonnet-5"],
      ["google", "gemini-3-pro"],
    ] as const) {
      expect(enxergaImagem({ provider: p, modelId: m, doCatalogo: CATALOGO_ERRADO }))
        .toBe(modelCapabilities(p, m).image);
    }
  });
});

describe("o que o motor NÃO conhece continua vindo do catálogo", () => {
  it("provedor desconhecido usa a coluna — é o único caso em que ela manda", () => {
    // A coluna não é lixo: o catálogo da OpenRouter a preenche a partir das
    // modalidades que o provedor declara. Onde o registro não tem opinião, ela
    // é o que sobra. Descartá-la seria trocar uma cegueira por outra.
    expect(enxergaImagem({ provider: "provedor-do-cliente", modelId: "modelo-x", doCatalogo: true })).toBe(true);
    expect(enxergaImagem({ provider: "provedor-do-cliente", modelId: "modelo-x", doCatalogo: false })).toBe(false);
  });

  it("desconhecido e sem informação nenhuma: não afirma que enxerga", () => {
    expect(enxergaImagem({ provider: "provedor-do-cliente", modelId: "modelo-x", doCatalogo: null })).toBe(false);
  });

  it("embedding e whisper continuam fora, mesmo em provedor capaz", () => {
    // A deny-list do registro vale: um modelo de embedding num provedor
    // multimodal não vira multimodal.
    expect(enxergaImagem({ provider: "openai", modelId: "text-embedding-3-small", doCatalogo: true })).toBe(false);
    expect(enxergaImagem({ provider: "openai", modelId: "whisper-1", doCatalogo: true })).toBe(false);
  });
});

describe("ponto FIXO anuncia o que ele mesmo usa", () => {
  /**
   * A tela mostrava `claude-sonnet-5` em "Ouvir o áudio do cliente", com
   * "usando o padrão da organização" — ao lado do próprio texto do ponto, que
   * diz "usa o padrão de transcrição da OpenAI". A mesma tela afirmando duas
   * coisas incompatíveis sobre o mesmo ponto.
   *
   * A causa: um ponto `fixo` percorria a cadeia de resolução dos pontos de
   * CONVERSA e caía no último degrau. Modelo de conversa não transcreve áudio —
   * anunciar um ali manda quem opera caçar problema que não existe.
   */
  it("transcricao_de_audio anuncia whisper, e não o modelo de conversa da org", () => {
    const d = decidirBinding({
      pontoId: "transcricao_de_audio",
      binding: null,
      agentePublicado: null,
      modeloDeAmbiente: undefined,
      padraoDaOrganizacao: { provider: "anthropic", defaultModel: "claude-sonnet-5" },
    });

    expect(d.modelId).toBe("whisper-1");
    expect(d.origem).toBe("fixo_do_produto");
    expect(d.modelId, "voltou a anunciar o modelo de conversa").not.toBe("claude-sonnet-5");
  });

  it("o ponto fixo ignora até um binding salvo — a escolha do painel não se aplica", () => {
    // Controle: alguém pode ter um binding antigo gravado para este ponto. Ele
    // não pode ressuscitar o comportamento errado.
    const d = decidirBinding({
      pontoId: "transcricao_de_audio",
      binding: {
        purpose: "transcricao_de_audio",
        provider: "openai",
        model_id: "gpt-5.6-sol",
        credential_id: null,
        base_url: null,
        is_enabled: true,
      },
      agentePublicado: null,
      modeloDeAmbiente: undefined,
      padraoDaOrganizacao: { provider: "anthropic", defaultModel: "claude-sonnet-5" },
    });
    expect(d.modelId).toBe("whisper-1");
  });

  it("ponto NÃO fixo segue a cadeia normal (controle positivo)", () => {
    // Sem este caso, "todo ponto devolve whisper" satisfaria os dois acima.
    //
    // A asserção é sobre NÃO ser o ramo fixo, e não sobre qual modelo sai: com
    // `agentePublicado: null` e sem binding, `visao_de_imagem` cai em
    // `variavel_de_ambiente` (medido) — degrau que não tem nada a ver com este
    // conserto. Prender o modelo aqui seria prender comportamento alheio.
    const d = decidirBinding({
      pontoId: "visao_de_imagem",
      binding: null,
      agentePublicado: null,
      modeloDeAmbiente: undefined,
      padraoDaOrganizacao: { provider: "openai", defaultModel: "gpt-5.6-sol" },
    });
    expect(d.origem).not.toBe("fixo_do_produto");
    expect(d.modelId).not.toBe("whisper-1");
  });
});
