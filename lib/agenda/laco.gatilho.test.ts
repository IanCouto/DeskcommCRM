/**
 * O gatilho de automação que cada transição da agenda emite.
 *
 * O caso que justifica o arquivo é o terceiro: `pending → confirmed` devolve
 * `null` na timeline e um gatilho AQUI. Reaproveitar `atividadeDaTransicao`
 * para as duas perguntas é a simplificação óbvia e errada — apagaria justamente
 * o momento em que o horário deixa de ser pedido e vira compromisso, que é o
 * gancho de "avise a cliente que está confirmado".
 */
import { describe, expect, it } from "vitest";

import { atividadeDaTransicao, gatilhoDaTransicao } from "./laco";

describe("gatilhoDaTransicao", () => {
  it("nascer pendente ou confirmado é o mesmo gatilho: foi marcado", () => {
    expect(gatilhoDaTransicao(null, "pending")).toBe("appointment.created");
    expect(gatilhoDaTransicao(null, "confirmed")).toBe("appointment.created");
  });

  it("confirmar um pendente emite gatilho, mesmo sem virar linha do tempo", () => {
    expect(gatilhoDaTransicao("pending", "confirmed")).toBe("appointment.confirmed");
    // A régua da timeline discorda de propósito — é o ponto deste módulo.
    expect(atividadeDaTransicao("pending", "confirmed")).toBeNull();
  });

  it("confirmar o que já estava confirmado não emite nada", () => {
    expect(gatilhoDaTransicao("confirmed", "confirmed")).toBeNull();
  });

  it("remarcar e cancelar emitem os seus", () => {
    expect(gatilhoDaTransicao("confirmed", "rescheduled")).toBe("appointment.rescheduled");
    expect(gatilhoDaTransicao("confirmed", "cancelled")).toBe("appointment.cancelled");
    expect(gatilhoDaTransicao("pending", "cancelled")).toBe("appointment.cancelled");
  });

  it("compareceu e faltou emitem os SEUS — uma vez cada (#1612)", () => {
    // Dois eventos para o mesmo fato SÓ fariam a regra rodar duas vezes se ela
    // pudesse assinar os dois; não pode, um gatilho por evento. O que a issue
    // pedia era justamente estes dois, e a fonte deles é a TRANSIÇÃO —
    // `appointment.outcome_confirmed` (o outro emissor) só nasce para falta.
    expect(gatilhoDaTransicao("confirmed", "completed")).toBe("appointment.completed");
    expect(gatilhoDaTransicao("confirmed", "no_show")).toBe("appointment.no_show");
    // Da MESMA situação anterior: uma correção (compareu → faltou) é outro
    // fato, e cada um tem o seu gatilho.
    expect(gatilhoDaTransicao("completed", "no_show")).toBe("appointment.no_show");
  });

  it("nascer já cancelado ou concluído não é gatilho de nada", () => {
    expect(gatilhoDaTransicao(null, "cancelled")).toBeNull();
    expect(gatilhoDaTransicao(null, "completed")).toBeNull();
  });

  it("reenviar o mesmo status não emite de novo: é o guard de 'uma vez cada'", () => {
    // `atualizarAgendamento` só constrói transição quando o status MUDOU, mas
    // a régua pura também recusa — dois emissores, a mesma regra.
    expect(gatilhoDaTransicao("completed", "completed")).toBeNull();
    expect(gatilhoDaTransicao("no_show", "no_show")).toBeNull();
  });
});
