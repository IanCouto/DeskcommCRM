import { capacidadeEhConhecida, modelCapabilities } from "@/lib/agent-engine/edge/llm/capabilities";

/**
 * A CAPACIDADE QUE VALE — a mesma que o motor usa, para a tela e para o motor.
 *
 * ═══ O defeito: duas verdades sobre a mesma pergunta ════════════════════════
 *
 * "Este modelo enxerga imagem?" tinha DUAS respostas no repositório:
 *
 *   • o MOTOR perguntava a `modelCapabilities()` — registro por provedor, com
 *     `openai` e `anthropic` marcados como nativos;
 *   • a TELA perguntava à coluna `ai_models.supports_vision`.
 *
 * Medido numa instalação real: a coluna estava `false` para TODOS os modelos
 * do catálogo — `claude-sonnet-5`, `gpt-5.6-sol`, `gpt-5.6-luna`,
 * `gpt-5.6-terra`. Então a tela avisava
 *
 *     "gpt-5.6-sol não enxerga imagens. Em 'Ver a imagem do cliente', fotos e
 *      comprovantes que o cliente enviar vão ser ignorados pelo agente."
 *
 * enquanto o motor mandava a imagem normalmente — e ela era lida. O print que o
 * cliente enviou virou descrição correta na mesma instalação em que a tela
 * dizia que seria ignorado.
 *
 * ⚠️ E o aviso falso é PIOR que aviso nenhum: ele empurra quem opera a trocar
 * um modelo que funciona, ou a desistir de um recurso que está no ar.
 *
 * ═══ Por que a fonte é o motor, e não a tabela ══════════════════════════════
 *
 * Porque é o motor que decide, em tempo de execução, se a mídia vai como parte
 * nativa. A tabela é um catálogo de preço e contexto que alguém preenche; o
 * registro é o que o código faz. Corrigir a linha do `gpt-5.6-sol` apagaria o
 * sintoma e deixaria a divergência viva para o próximo modelo cadastrado.
 *
 * A coluna continua existindo e ainda vale para uma coisa: o catálogo da
 * OpenRouter a preenche a partir das modalidades que o provedor declara
 * (`lib/ai/catalogo/openrouter.ts`). Onde o registro NÃO conhece o
 * provedor/modelo, a coluna é o que sobra — e aí ela é usada. É a diferença
 * entre "sei que não" e "não sei", que `capacidadeEhConhecida` já modela.
 */
export function enxergaImagem(input: {
  provider: string;
  modelId: string;
  /** O que a tabela `ai_models` diz. Só vale onde o registro não conhece. */
  doCatalogo?: boolean | null;
}): boolean {
  if (capacidadeEhConhecida(input.provider, input.modelId)) {
    return modelCapabilities(input.provider, input.modelId).image;
  }
  return input.doCatalogo ?? false;
}
