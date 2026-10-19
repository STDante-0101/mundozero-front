import { describe, expect, it, vi } from 'vitest';

import { criarPonte, ORIGEM_VOID, VERSAO_PONTE } from './ponte';
import { criarPontePlayer, TRAVADOS_CONVIDADO } from './player';

const FILME = '0123456789abcdef0123456789abcdef';
const OUTRO = 'fedcba9876543210fedcba9876543210';

// Player falso com o MESMO funil do index.js: cada método do playbackManager
// passa por intercepta antes de mexer no estado.
function montar() {
    let intercepta = null;
    let aoEvento = null;
    const s = { filmeId: null, posicaoMs: 0, duracaoMs: 600000, pausado: false, carregando: false, taxa: 1 };
    const marcas = [];
    const pm = {};
    const fazer = {
        play: (o) => Object.assign(s, { filmeId: o.filmeId, posicaoMs: o.posicaoMs, pausado: false, carregando: true }),
        pause: () => { s.pausado = true; },
        unpause: () => { s.pausado = false; },
        playPause: () => { s.pausado = !s.pausado; },
        seekMs: (ms) => { s.posicaoMs = ms; },
        seek: (t) => { s.posicaoMs = t / 10000; },
        stop: () => { s.filmeId = null; }
    };
    for (const nome of [...TRAVADOS_CONVIDADO, 'stop']) {
        pm[nome] = (...args) => {
            if (intercepta && !intercepta(nome, args)) return 'bloqueado';
            fazer[nome]?.(...args);
            return 'ok';
        };
    }
    const player = {
        estado: () => (s.filmeId ? { ...s } : null),
        carregar: vi.fn((filmeId, posicaoMs) => pm.play({ filmeId, posicaoMs })),
        tocar: vi.fn(() => pm.unpause()),
        pausar: vi.fn(() => pm.pause()),
        pularMs: vi.fn((ms) => pm.seekMs(ms)),
        velocidade: vi.fn((t) => { s.taxa = t; }),
        instalarFunil: vi.fn((f) => { intercepta = f; }),
        ouvir: vi.fn((f) => { aoEvento = f; }),
        marcar: vi.fn((...a) => marcas.push(a))
    };
    const enviar = vi.fn();
    const relogios = [];
    const atrasados = [];
    const p = criarPontePlayer({
        enviar,
        player,
        repetir: (f) => relogios.push(f),
        parar: vi.fn(),
        depois: (f) => atrasados.push(f)
    });
    const enviadas = (tipo) => enviar.mock.calls.filter(c => !tipo || c[0] === tipo).map(c => c[1]);
    const evento = (nome) => aoEvento?.(nome);
    const tique = () => {
        for (const f of relogios) f();
    };
    const rodarAtrasados = () => {
        for (const f of atrasados.splice(0)) f();
    };
    return { p, s, pm, player, enviar, enviadas, evento, tique, rodarAtrasados, marcas };
}

describe('ponte v2 — controle do player', () => {
    it('INERTE antes do void:modo: não instala funil, não manda nada, ignora comandos', () => {
        const t = montar();
        expect(t.p.receber({ tipo: 'void:carregar', filmeId: FILME, posicaoMs: 0, pausado: false })).toBe(true);
        expect(t.p.receber({ tipo: 'void:pausar', posicaoMs: 0 })).toBe(true);
        t.tique();
        expect(t.player.instalarFunil).not.toHaveBeenCalled();
        expect(t.player.carregar).not.toHaveBeenCalled();
        expect(t.enviar).not.toHaveBeenCalled();
        expect(t.pm.pause()).toBe('ok'); // sem funil, nada travado
    });

    it('mensagem que não é da ponte do player volta false (fica para o login)', () => {
        const t = montar();
        expect(t.p.receber({ tipo: 'void:entrar' })).toBe(false);
        expect(t.p.receber({ tipo: 'mz:qualquer' })).toBe(false);
    });

    it('void:modo dona liga: funil, ouvinte, mz:estado a cada 1 s', () => {
        const t = montar();
        t.p.receber({ tipo: 'void:modo', modo: 'dona', dona: 'Arthas' });
        expect(t.player.instalarFunil).toHaveBeenCalledTimes(1);
        expect(t.player.ouvir).toHaveBeenCalledTimes(1);
        expect(t.enviadas('mz:estado').at(-1)).toEqual({ estado: 'parado', posicaoMs: 0, filmeId: null, duracaoMs: null, taxa: 1 });
        Object.assign(t.s, { filmeId: FILME, posicaoMs: 1234.6 });
        t.tique();
        expect(t.enviadas('mz:estado').at(-1)).toMatchObject({ estado: 'tocando', posicaoMs: 1235, filmeId: FILME, duracaoMs: 600000 });
        t.s.carregando = true;
        t.tique();
        expect(t.enviadas('mz:estado').at(-1).estado).toBe('carregando');
    });

    it('void:carregar abre o filme na posição, pausado espera tocar e pausa; mz:pronto quando chega', () => {
        const t = montar();
        t.p.receber({ tipo: 'void:modo', modo: 'convidado', dona: 'Arthas' });
        t.p.receber({ tipo: 'void:carregar', filmeId: FILME.toUpperCase(), posicaoMs: 60000, pausado: true, legenda: 3 });
        expect(t.player.carregar).toHaveBeenCalledWith(FILME, 60000); // id normalizado; legenda ignorada
        expect(t.enviadas('mz:pronto')).toHaveLength(0); // ainda carregando
        t.s.carregando = false;
        t.evento('playbackstart');
        t.evento('playing');
        expect(t.s.pausado).toBe(true); // pausou sozinho (pausado: true)
        expect(t.enviadas('mz:pronto')).toEqual([{ filmeId: FILME, posicaoMs: 60000 }]);
        expect(t.enviadas('mz:bloqueado')).toHaveLength(0); // a ponte passa pelo funil
        expect(t.enviadas('mz:acao')).toHaveLength(0);
    });

    it('carregar pausado SEM o evento playing (saiu antes de a ponte ouvir — medido no :8443): o tique pausa e manda mz:pronto', () => {
        const t = montar();
        t.p.receber({ tipo: 'void:modo', modo: 'convidado' });
        t.p.receber({ tipo: 'void:carregar', filmeId: FILME, posicaoMs: 30000, pausado: true });
        t.s.carregando = false; // o vídeo já toca; nenhum evento chegou
        t.tique();
        expect(t.s.pausado).toBe(true);
        expect(t.enviadas('mz:estado').at(-1).estado).toBe('pausado');
        expect(t.enviadas('mz:pronto')).toEqual([{ filmeId: FILME, posicaoMs: 30000 }]);
        expect(t.enviadas('mz:acao')).toHaveLength(0);
    });

    it('carregar o MESMO filme só posiciona (não recarrega)', () => {
        const t = montar();
        t.p.receber({ tipo: 'void:modo', modo: 'convidado' });
        Object.assign(t.s, { filmeId: FILME, posicaoMs: 1000 });
        t.p.receber({ tipo: 'void:carregar', filmeId: FILME, posicaoMs: 90000, pausado: false });
        expect(t.player.carregar).not.toHaveBeenCalled();
        expect(t.s.posicaoMs).toBe(90000);
        expect(t.enviadas('mz:pronto')).toEqual([{ filmeId: FILME, posicaoMs: 90000 }]);
    });

    it('void:tocar / pausar / pular / velocidade mexem no player (com tolerâncias)', () => {
        const t = montar();
        t.p.receber({ tipo: 'void:modo', modo: 'convidado' });
        Object.assign(t.s, { filmeId: FILME, posicaoMs: 10000, pausado: true });
        t.p.receber({ tipo: 'void:tocar', posicaoMs: 11000 }); // perto: não pula
        expect(t.s.pausado).toBe(false);
        expect(t.player.pularMs).not.toHaveBeenCalled();
        t.p.receber({ tipo: 'void:tocar', posicaoMs: 20000 }); // longe: pula
        expect(t.s.posicaoMs).toBe(20000);
        t.p.receber({ tipo: 'void:pausar', posicaoMs: 21000 });
        expect(t.s.pausado).toBe(true);
        expect(t.s.posicaoMs).toBe(21000);
        t.p.receber({ tipo: 'void:pular', posicaoMs: 300000 });
        expect(t.s.posicaoMs).toBe(300000);
        expect(t.enviadas('mz:pronto').at(-1)).toEqual({ filmeId: FILME, posicaoMs: 300000 });
        t.p.receber({ tipo: 'void:velocidade', taxa: 1.05 });
        expect(t.s.taxa).toBe(1.05);
        t.p.receber({ tipo: 'void:velocidade', taxa: 2 }); // fora da faixa
        expect(t.s.taxa).toBe(1.05);
        expect(t.enviadas('mz:bloqueado')).toHaveLength(0);
    });

    it('campos fora do formato são ignorados', () => {
        const t = montar();
        t.p.receber({ tipo: 'void:modo', modo: 'dona' });
        t.p.receber({ tipo: 'void:modo', modo: 'chefe' });
        expect(t.p.modo()).toBe('dona');
        t.p.receber({ tipo: 'void:carregar', filmeId: 'nao-e-id', posicaoMs: 0, pausado: false });
        t.p.receber({ tipo: 'void:carregar', filmeId: FILME, posicaoMs: -5, pausado: false });
        t.p.receber({ tipo: 'void:carregar', filmeId: FILME, posicaoMs: '10', pausado: false });
        t.p.receber({ tipo: 'void:carregar', filmeId: FILME, posicaoMs: 0, pausado: 'sim' });
        expect(t.player.carregar).not.toHaveBeenCalled();
        t.s.filmeId = FILME;
        t.p.receber({ tipo: 'void:pular', posicaoMs: NaN });
        t.p.receber({ tipo: 'void:pausar' });
        expect(t.player.pularMs).not.toHaveBeenCalled();
        expect(t.player.pausar).not.toHaveBeenCalled();
    });

    it.each(TRAVADOS_CONVIDADO)('convidado: %s travado no funil → mz:bloqueado', (nome) => {
        const t = montar();
        t.p.receber({ tipo: 'void:modo', modo: 'convidado', dona: 'Arthas' });
        t.s.filmeId = FILME;
        expect(t.pm[nome]({ filmeId: OUTRO, posicaoMs: 0 })).toBe('bloqueado');
        expect(t.enviadas('mz:bloqueado')).toHaveLength(1);
        expect(t.enviadas('mz:acao')).toHaveLength(0);
    });

    it('convidado: começar outro filme (E.1) é bloqueado como "carregar"; sair do filme (stop) é livre', () => {
        const t = montar();
        t.p.receber({ tipo: 'void:modo', modo: 'convidado' });
        t.s.filmeId = FILME;
        expect(t.pm.play({ filmeId: OUTRO, posicaoMs: 0 })).toBe('bloqueado');
        expect(t.pm.nextTrack()).toBe('bloqueado');
        expect(t.enviadas('mz:bloqueado')).toEqual([{ acao: 'carregar' }, { acao: 'carregar' }]);
        expect(t.s.filmeId).toBe(FILME);
        expect(t.pm.stop()).toBe('ok');
        expect(t.s.filmeId).toBeNull();
    });

    it('convidado: marca o <body> e o aviso "Quem controla é {dona}" só enquanto toca', () => {
        const t = montar();
        t.p.receber({ tipo: 'void:modo', modo: 'convidado', dona: 'Arthas' });
        expect(t.marcas.at(-1)).toEqual([true, 'Arthas', false]);
        t.s.filmeId = FILME;
        t.tique();
        expect(t.marcas.at(-1)).toEqual([true, 'Arthas', true]);
    });

    it('dona: o que ela faz vira mz:acao (pausar, tocar, pular, parar, filme novo)', () => {
        const t = montar();
        t.p.receber({ tipo: 'void:modo', modo: 'dona', dona: 'Arthas' });
        Object.assign(t.s, { filmeId: FILME, posicaoMs: 5000 });
        expect(t.pm.pause()).toBe('ok');
        expect(t.pm.unpause()).toBe('ok');
        t.pm.playPause(); // estava tocando → pausar
        t.pm.seekMs(70000);
        t.rodarAtrasados(); // o pulo é lido logo depois
        expect(t.enviadas('mz:acao')).toEqual([
            { acao: 'pausar', filmeId: FILME, posicaoMs: 5000 },
            { acao: 'tocar', filmeId: FILME, posicaoMs: 5000 },
            { acao: 'pausar', filmeId: FILME, posicaoMs: 5000 },
            { acao: 'pular', filmeId: FILME, posicaoMs: 70000 }
        ]);
        // filme novo (biblioteca, próximo episódio): sai pelo playbackstart
        t.pm.play({ filmeId: OUTRO, posicaoMs: 0 });
        t.evento('playbackstart');
        expect(t.enviadas('mz:acao').at(-1)).toEqual({ acao: 'carregar', filmeId: OUTRO, posicaoMs: 0 });
        t.pm.stop();
        expect(t.enviadas('mz:acao').at(-1).acao).toBe('parar');
        expect(t.enviadas('mz:bloqueado')).toHaveLength(0);
    });

    it('ECO: o que a ponte aplica por ordem do VOID não volta como mz:acao', () => {
        const t = montar();
        t.p.receber({ tipo: 'void:modo', modo: 'dona' });
        t.p.receber({ tipo: 'void:carregar', filmeId: FILME, posicaoMs: 0, pausado: false });
        t.s.carregando = false;
        t.evento('playbackstart'); // eco do carregar
        t.p.receber({ tipo: 'void:pausar', posicaoMs: 0 });
        t.p.receber({ tipo: 'void:pular', posicaoMs: 9000 });
        t.p.receber({ tipo: 'void:tocar', posicaoMs: 9000 });
        t.rodarAtrasados();
        expect(t.enviadas('mz:acao')).toHaveLength(0);
    });

    it('modo livre: destrava tudo, velocidade 1,0, para o mz:estado', () => {
        const t = montar();
        t.p.receber({ tipo: 'void:modo', modo: 'convidado', dona: 'Arthas' });
        t.s.filmeId = FILME;
        t.p.receber({ tipo: 'void:velocidade', taxa: 0.95 });
        t.p.receber({ tipo: 'void:modo', modo: 'livre' });
        expect(t.s.taxa).toBe(1);
        expect(t.marcas.at(-1)).toEqual([false, '', false]);
        const n = t.enviar.mock.calls.length;
        expect(t.pm.pause()).toBe('ok');
        expect(t.pm.play({ filmeId: OUTRO, posicaoMs: 0 })).toBe('ok');
        t.tique();
        t.p.receber({ tipo: 'void:pausar', posicaoMs: 0 }); // comando sem modo ativo: ignorado
        expect(t.enviar.mock.calls.length).toBe(n);
    });
});

describe('ponte v2 — ligação com o núcleo do login (ponte.js)', () => {
    function montarPonte() {
        const pai = { postMessage: vi.fn() };
        let ouvinte = null;
        const janela = {
            parent: pai,
            addEventListener: vi.fn((_t, f) => {
                ouvinte = f;
            }),
            removeEventListener: vi.fn()
        };
        const extra = { receber: vi.fn(() => true) };
        let enviarDado = null;
        criarPonte({
            janela,
            estado: () => ({ logado: false, usuarioId: null }),
            criarExtra: (enviar) => {
                enviarDado = enviar;
                return extra;
            }
        });
        const doVoid = (data, origem = ORIGEM_VOID, source = pai) => ouvinte({ origin: origem, source, data });
        return { pai, extra, doVoid, enviar: () => enviarDado };
    }

    it('mz:ola anuncia a versão 2', () => {
        const { pai } = montarPonte();
        expect(VERSAO_PONTE).toBe(2);
        expect(pai.postMessage.mock.calls[0][0]).toMatchObject({ tipo: 'mz:ola', versao: 2 });
    });

    it('mensagens do player chegam ao núcleo do player com a MESMA checagem de origem e janela', () => {
        const { extra, doVoid } = montarPonte();
        doVoid({ tipo: 'void:modo', modo: 'dona' }, 'https://outro.site');
        doVoid({ tipo: 'void:modo', modo: 'dona' }, ORIGEM_VOID, {});
        doVoid({ tipo: 'void:modo', modo: 'dona' }, 'https://tower-1.tail646ed6.ts.net:8443');
        doVoid('void:modo');
        expect(extra.receber).not.toHaveBeenCalled();
        doVoid({ tipo: 'void:modo', modo: 'dona' });
        expect(extra.receber).toHaveBeenCalledWith({ tipo: 'void:modo', modo: 'dona' });
    });

    it('o player envia só para a origem do VOID', () => {
        const { pai, enviar } = montarPonte();
        enviar()('mz:estado', { estado: 'parado' });
        expect(pai.postMessage).toHaveBeenLastCalledWith({ tipo: 'mz:estado', estado: 'parado' }, ORIGEM_VOID);
    });
});
