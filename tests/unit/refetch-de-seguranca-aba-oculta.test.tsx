import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode, type RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRefetchDeSeguranca } from "@/hooks/realtime/useRefetchDeSeguranca";

/**
 * A rede de segurança existia para a aba EM FOCO com o canal morto. O
 * `setInterval` rodava também com a aba no fundo, e no Hobby cada tick é
 * Function. Voltar para a aba já dispara `verificar` no visibilitychange —
 * o intervalo no fundo não curava nada que a volta não cure.
 */

describe("useRefetchDeSeguranca — aba oculta não busca", () => {
  let visivel = "visible";

  beforeEach(() => {
    visivel = "visible";
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visivel,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    visivel = "visible";
  });

  function montar(qc: QueryClient) {
    const ultimaEntrega: RefObject<number | null> = { current: null };
    return renderHook(
      () =>
        useRefetchDeSeguranca({
          queryKey: ["x"],
          assinatura: () => "a",
          ultimaEntrega,
          intervaloMs: 1_000,
        }),
      {
        wrapper: ({ children }: { children: ReactNode }) =>
          createElement(QueryClientProvider, { client: qc }, children),
      },
    );
  }

  it("com a aba oculta o intervalo não refetch", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, "refetchQueries").mockResolvedValue([]);
    visivel = "hidden";
    montar(qc);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("com a aba visível o intervalo segue sendo a rede de segurança", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, "refetchQueries").mockResolvedValue([]);
    visivel = "visible";
    montar(qc);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(spy).toHaveBeenCalled();
  });

  it("voltar para a aba busca na hora — o socket pode ter morrido no fundo", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, "refetchQueries").mockResolvedValue([]);
    visivel = "hidden";
    montar(qc);
    visivel = "visible";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(spy).toHaveBeenCalled();
  });
});
