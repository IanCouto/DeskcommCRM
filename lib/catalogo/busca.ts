/**
 * ACHAR O PRODUTO QUE O CLIENTE DESCREVEU — e não o parecido.
 *
 * ═══ Por que não é `ilike '%termo%'` ════════════════════════════════════════
 *
 * Porque o cliente não digita o nome do catálogo. Ele escreve "ifone 15",
 * "15 pro max 256", "perfume 212 masculino". Medido num corpus de 20 mil
 * títulos de importados:
 *
 *     ilike '%ifone 15%'              -> 0 linhas
 *     ilike '%perfume 212 masculino%' -> 0 linhas
 *
 * E o trigrama da frase INTEIRA também não resolve: a similaridade entre
 * "ifone 15" e "iphone 15 pro 256gb titanio natural" é 0,154 — abaixo do limiar
 * padrão —, porque a métrica pune a diferença de tamanho. Pontuar a consulta
 * inteira não funciona; tem de ser token a token.
 *
 * ═══ A regra que decide tudo: PALAVRA é difusa, NÚMERO é exato ══════════════
 *
 * A similaridade entre "iPhone 15 Pro 256GB" e "iPhone 15 Pro 128GB" é
 * altíssima — nenhum ajuste de limiar separa 128 de 256. E é exatamente aí que
 * o preço erra, que é o erro que não se pode cometer com um cliente.
 *
 * Então o número não é ranqueado: ele FILTRA. Um número que a pessoa disse e
 * que não existe no produto elimina o produto, não o rebaixa.
 *
 *   - token de PALAVRA ("ifone", "perfume", "titanio") → prefixo/trigrama,
 *     tolerante a erro de digitação;
 *   - token de NÚMERO ("15", "256", "212") → casamento exato, aceitando só um
 *     sufixo de unidade ("256" casa "256gb"; "15" NÃO casa "153ml").
 *
 * O sufixo de unidade não é detalhe: com a regra ingênua de prefixo, "ifone 15"
 * trouxe um "Fone Bluetooth A54 153ml" na frente dos iPhones — o "15" casou
 * "153ml" e o "ifone" casou "fone". Medido, e é o motivo de a regra existir.
 *
 * ═══ O que a busca faz quando há empate ════════════════════════════════════
 *
 * Devolve os dois. "iphone 15 pro 256" casa o Pro e o Pro Max com nota idêntica
 * — a ambiguidade é REAL, e a resposta certa é a pessoa escolher, não o modelo
 * chutar. Quem decide o que fazer com isso é a ferramenta, que avisa o agente.
 */

/** Sem `unaccent` no banco: a normalização de acento é nossa, e é a mesma dos dois lados. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Palavras que não distinguem produto nenhum e só atrapalham a nota.
 *
 * Curta de propósito: lista grande de stopword começa a comer termo que importa
 * ("pro", "air", "max" são modelo, não ruído).
 */
const RUIDO = new Set(["de", "do", "da", "com", "para", "por", "the", "e", "o", "a", "um", "uma"]);

export interface TokensDaBusca {
  /** Tokens difusos — casam por prefixo/semelhança. */
  palavras: string[];
  /** Tokens exatos — filtram, não pontuam. */
  numeros: string[];
}

export function tokenizar(consulta: string): TokensDaBusca {
  const palavras: string[] = [];
  const numeros: string[] = [];
  for (const t of normalizar(consulta).split(" ")) {
    if (t === "" || RUIDO.has(t)) continue;
    // "256gb" é número com unidade colada: o número é a identidade.
    const comUnidade = /^(\d+)([a-z]{1,4})?$/.exec(t);
    if (comUnidade?.[1] !== undefined) numeros.push(comUnidade[1]);
    else palavras.push(t);
  }
  return { palavras, numeros };
}

/**
 * O número aparece neste texto como NÚMERO?
 *
 * `256` casa "256gb" e "256 gb"; NÃO casa "1256" nem "153ml" quando o número é
 * 15. A âncora de início e o sufixo curto são o que separam os dois casos.
 */
function temONumero(alvoNormalizado: string, numero: string): boolean {
  return new RegExp(`(^|\\s)${numero}([a-z]{1,4})?($|\\s)`).test(alvoNormalizado);
}

export interface ProdutoBuscavel {
  nome: string;
  codigo: string;
  marca?: string | null;
  categoria?: string | null;
}

/**
 * Nota de 0 a 1 — ou `null` quando o produto é ELIMINADO.
 *
 * `null` não é "nota zero": é "este produto está descartado", e a diferença
 * importa para quem chama. Um número que a pessoa disse e o produto não tem é
 * eliminação, porque é o que impede o 128GB de aparecer para quem pediu 256GB.
 */
export function pontuar(produto: ProdutoBuscavel, tokens: TokensDaBusca): number | null {
  const alvo = normalizar(
    [produto.nome, produto.marca ?? "", produto.categoria ?? "", produto.codigo].join(" "),
  );

  // ── O FILTRO DURO ──────────────────────────────────────────────────────────
  for (const n of tokens.numeros) {
    if (!temONumero(alvo, n)) return null;
  }

  if (tokens.palavras.length === 0) {
    // Só números, e todos casaram: é um acerto legítimo ("256", "212").
    return tokens.numeros.length > 0 ? 1 : null;
  }

  const doAlvo = alvo.split(" ");
  let soma = 0;
  for (const p of tokens.palavras) {
    // A nota do token é a QUALIDADE do melhor casamento, não um sim/não. É o
    // que faz "ifone" preferir "iphone" a "fone": os dois casam, e o primeiro
    // casa melhor. Com nota binária os dois empatavam, e o empate punha um fone
    // de ouvido ao lado de um celular de dez mil reais.
    let melhor = 0;
    for (const t of doAlvo) {
      // ⚠️ A INICIAL VALE MAIS QUE A DISTÂNCIA, e isto foi medido: sem ela,
      // "ifone" devolvia o "Fone Bluetooth" (distância 1) NA FRENTE do "iPhone"
      // (distância 2) — um fone de ouvido no lugar de um celular de dez mil.
      // Quem digita rápido erra o meio da palavra; quase ninguém erra a
      // primeira letra. É o sinal que separa "faltou uma letra" de "é outra
      // palavra que por acaso se parece".
      const mesmaInicial = t[0] === p[0];
      let nota = 0;
      if (t === p) nota = 1;
      else if (t.startsWith(p) || p.startsWith(t)) nota = 0.9;
      else if (p.length >= 4 && distanciaAte(p, t, 1)) nota = mesmaInicial ? 0.75 : 0.5;
      // Distância 2 só para palavra longa: é o caso de "ifone" × "iphone" (falta
      // uma letra E troca outra). Abaixo de 5 letras a tolerância vira ruído —
      // "mac" alcançaria "max", que é outro produto.
      else if (p.length >= 5 && distanciaAte(p, t, 2)) nota = mesmaInicial ? 0.6 : 0;
      if (nota > melhor) melhor = nota;
    }
    soma += melhor;
  }

  if (soma === 0) return null;
  return soma / tokens.palavras.length;
}

/** As duas palavras diferem por no máximo `teto` edições? */
function distanciaAte(a: string, b: string, teto: number): boolean {
  if (Math.abs(a.length - b.length) > teto) return false;
  // Levenshtein com corte: para palavras desta ordem de grandeza a matriz é
  // barata, e o corte evita percorrer tudo quando já passou do teto.
  const anterior: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const atual = [i];
    let menorNaLinha = i;
    for (let j = 1; j <= b.length; j += 1) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(
        (atual[j - 1] ?? 0) + 1,
        (anterior[j] ?? 0) + 1,
        (anterior[j - 1] ?? 0) + custo,
      );
      atual.push(v);
      if (v < menorNaLinha) menorNaLinha = v;
    }
    if (menorNaLinha > teto) return false;
    for (let k = 0; k <= b.length; k += 1) anterior[k] = atual[k] ?? 0;
  }
  return (anterior[b.length] ?? teto + 1) <= teto;
}

export interface Achado<T> {
  produto: T;
  nota: number;
}

/**
 * Ordena os candidatos pela nota, descartando os eliminados.
 *
 * Empate é preservado: quem chama precisa saber que houve mais de um, para
 * perguntar em vez de escolher.
 */
/**
 * O NÚMERO QUE NÃO É ATRIBUTO NÃO PODE ZERAR A BUSCA.
 *
 * O filtro numérico existe para impedir que quem pede 128GB veja o 256GB. Mas
 * ele tratava TODO número da frase como atributo — e o cliente diz números que
 * não são atributo de produto nenhum:
 *
 *     "quero 2 iphone 15"        -> 0 resultados (o "2" elimina tudo)
 *     "tenho 3000 pra gastar"    -> 0 resultados
 *     "me ve 5 peliculas"        -> 0 resultados
 *
 * Zero resultado num pedido de compra explícito é o pior desfecho da busca: o
 * agente responde "não encontrei" para quem estava comprando.
 *
 * A regra que separa os dois casos se calibra sozinha no catálogo: um número só
 * é vocabulário de atributo se ele APARECE em algum produto. "128" aparece,
 * "2" não aparece em lugar nenhum — então "2" é quantidade, e quantidade não
 * filtra.
 *
 * ⚠️ E o caso que a regra NÃO pode estragar: "iphone 15 512" quando não há
 * iPhone de 512. O "512" existe no catálogo (nos MacBooks), então continua
 * sendo atributo, continua filtrando, e a busca devolve VAZIO — que é a
 * resposta certa: a loja não tem esse iPhone. Ignorar o 512 ali devolveria o
 * de 128GB para quem pediu 512, que é o erro de preço que esta busca existe
 * para não cometer.
 */
function numerosQueOCatalogoConhece<T extends ProdutoBuscavel>(
  produtos: readonly T[],
  numeros: readonly string[],
): Set<string> {
  const conhecidos = new Set<string>();
  if (numeros.length === 0) return conhecidos;

  for (const produto of produtos) {
    const alvo = normalizar(
      [produto.nome, produto.marca ?? "", produto.categoria ?? "", produto.codigo].join(" "),
    );
    for (const n of numeros) {
      if (!conhecidos.has(n) && temONumero(alvo, n)) conhecidos.add(n);
    }
    if (conhecidos.size === numeros.length) break;
  }
  return conhecidos;
}

export function ordenarPorRelevancia<T extends ProdutoBuscavel>(
  produtos: readonly T[],
  consulta: string,
): Achado<T>[] {
  const brutos = tokenizar(consulta);
  if (brutos.palavras.length === 0 && brutos.numeros.length === 0) return [];

  // Só os números que o catálogo reconhece como atributo continuam filtrando.
  const conhecidos = numerosQueOCatalogoConhece(produtos, brutos.numeros);
  const tokens: TokensDaBusca = {
    palavras: brutos.palavras,
    numeros: brutos.numeros.filter((n) => conhecidos.has(n)),
  };

  // Descartar TODOS os números pode esvaziar a consulta ("quero 2", "me ve 5"):
  // aí não sobrou nada que identifique produto, e devolver o catálogo inteiro
  // seria pior que devolver nada.
  if (tokens.palavras.length === 0 && tokens.numeros.length === 0) return [];

  const achados: Achado<T>[] = [];
  for (const produto of produtos) {
    const nota = pontuar(produto, tokens);
    if (nota !== null) achados.push({ produto, nota });
  }
  return achados.sort((a, b) => b.nota - a.nota || a.produto.nome.localeCompare(b.produto.nome));
}
