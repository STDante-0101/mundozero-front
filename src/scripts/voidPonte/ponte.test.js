import { describe, expect, it, vi } from 'vitest';

import { criarPonte, ORIGEM_VOID, VERSAO_PONTE } from './ponte';

const SEGREDO = 'segredo-que-nunca-sai-da-aba';

function montar(opcoes = {}) {
    const pai = { postMessage: vi.fn() };
    let ouvinte = null;
    const janela = {
        parent: pai,
        addEventListener: vi.fn((_tipo, f) => { ouvinte = f; }),
        removeEventListener: vi.fn()
    };
    let logado = opcoes.logado ?? false;
    const deps = {
        janela,
        estado: () => ({ logado, usuarioId: logado ? 'id-atual' : null }),
        iniciarQuickConnect: vi.fn(async () => ({ codigo: '123456', segredo: SEGREDO })),
        consultarQuickConnect: vi.fn(async () => true),
        concluirLogin: vi.fn(async () => {
            logado = true;
            return 'id-novo';
        }),
        sair: vi.fn(async () => { logado = false; }),
        ...opcoes.deps
    };
    const ponte = criarPonte(deps);
    const enviadas = () => pai.postMessage.mock.calls.map(c => c[0]);
    const doVoid = (data, origem = ORIGEM_VOID, source = pai) => ouvinte({ origin: origem, source, data });
    return { ponte, pai, janela, deps, enviadas, doVoid };
}

const flush = async () => {
    for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0));
};

describe('ponte VOID <-> Mundo Zero', () => {
    it('fora de iframe não liga nem ouve nada', () => {
        const janela = { addEventListener: vi.fn() };
        janela.parent = janela;
        expect(criarPonte({ janela, estado: () => ({}) })).toBeNull();
        expect(janela.addEventListener).not.toHaveBeenCalled();
    });

    it('ao ligar avisa mz:ola só para a origem do VOID', () => {
        const { pai } = montar();
        expect(pai.postMessage).toHaveBeenCalledWith(
            { tipo: 'mz:ola', versao: VERSAO_PONTE, logado: false, usuarioId: null }, ORIGEM_VOID);
        expect(pai.postMessage.mock.calls.every(c => c[1] === ORIGEM_VOID)).toBe(true);
    });

    it('ignora mensagem de outra origem ou de outra janela', async () => {
        const { doVoid, enviadas, deps } = montar();
        doVoid({ tipo: 'void:entrar' }, 'https://outro.site');
        doVoid({ tipo: 'void:entrar' }, ORIGEM_VOID, {});
        doVoid({ tipo: 'void:entrar' }, 'https://tower-1.tail646ed6.ts.net:8443');
        await flush();
        expect(deps.iniciarQuickConnect).not.toHaveBeenCalled();
        expect(enviadas()).toHaveLength(1); // só o mz:ola inicial
    });

    it('ignora mensagem sem formato', async () => {
        const { doVoid, enviadas } = montar();
        doVoid(null);
        doVoid('void:ola');
        doVoid({ tipo: 7 });
        await flush();
        expect(enviadas()).toHaveLength(1);
    });

    it('void:ola responde se está logado e com qual conta', () => {
        const { doVoid, enviadas } = montar({ logado: true });
        doVoid({ tipo: 'void:ola' });
        expect(enviadas().at(-1)).toEqual({ tipo: 'mz:ola', versao: VERSAO_PONTE, logado: true, usuarioId: 'id-atual' });
    });

    it('void:entrar manda só o código de 6 dígitos', async () => {
        const { doVoid, enviadas, deps } = montar();
        doVoid({ tipo: 'void:entrar' });
        await flush();
        expect(deps.sair).not.toHaveBeenCalled();
        expect(enviadas().at(-1)).toEqual({ tipo: 'mz:codigo', code: '123456' });
    });

    it('void:entrar logado com outra conta sai antes de pedir o código', async () => {
        const ordem = [];
        const { doVoid, deps } = montar({
            logado: true,
            deps: {
                sair: vi.fn(async () => { ordem.push('sair'); }),
                iniciarQuickConnect: vi.fn(async () => {
                    ordem.push('iniciar');
                    return { codigo: '654321', segredo: SEGREDO };
                })
            }
        });
        doVoid({ tipo: 'void:entrar' });
        await flush();
        expect(deps.sair).toHaveBeenCalledTimes(1);
        expect(ordem).toEqual(['sair', 'iniciar']);
    });

    it('void:autorizado conclui o login na aba e avisa mz:login-ok', async () => {
        const { doVoid, enviadas, deps } = montar();
        doVoid({ tipo: 'void:entrar' });
        await flush();
        doVoid({ tipo: 'void:autorizado' });
        await flush();
        expect(deps.consultarQuickConnect).toHaveBeenCalledWith(SEGREDO);
        expect(deps.concluirLogin).toHaveBeenCalledWith(SEGREDO);
        expect(enviadas().at(-1)).toEqual({ tipo: 'mz:login-ok', usuarioId: 'id-novo' });
    });

    it('void:autorizado sem código pendente dá erro', async () => {
        const { doVoid, enviadas, deps } = montar();
        doVoid({ tipo: 'void:autorizado' });
        await flush();
        expect(deps.concluirLogin).not.toHaveBeenCalled();
        expect(enviadas().at(-1)).toEqual({ tipo: 'mz:login-erro', motivo: 'sem-codigo' });
    });

    it('código vencido (10 min) não conclui', async () => {
        let t = 0;
        const { doVoid, enviadas, deps } = montar({ deps: { agora: () => t } });
        doVoid({ tipo: 'void:entrar' });
        await flush();
        t = 10 * 60 * 1000 + 1;
        doVoid({ tipo: 'void:autorizado' });
        await flush();
        expect(deps.concluirLogin).not.toHaveBeenCalled();
        expect(enviadas().at(-1)).toEqual({ tipo: 'mz:login-erro', motivo: 'sem-codigo' });
    });

    it('o código só vale uma vez', async () => {
        const { doVoid, enviadas, deps } = montar();
        doVoid({ tipo: 'void:entrar' });
        await flush();
        doVoid({ tipo: 'void:autorizado' });
        await flush();
        doVoid({ tipo: 'void:autorizado' });
        await flush();
        expect(deps.concluirLogin).toHaveBeenCalledTimes(1);
        expect(enviadas().at(-1)).toEqual({ tipo: 'mz:login-erro', motivo: 'sem-codigo' });
    });

    it('servidor ainda não autenticou: não conclui', async () => {
        const { doVoid, enviadas, deps } = montar({ deps: { consultarQuickConnect: vi.fn(async () => false) } });
        doVoid({ tipo: 'void:entrar' });
        await flush();
        doVoid({ tipo: 'void:autorizado' });
        await flush();
        expect(deps.concluirLogin).not.toHaveBeenCalled();
        expect(enviadas().at(-1)).toEqual({ tipo: 'mz:login-erro', motivo: 'nao-autenticado' });
    });

    it('resposta do Initiate fora do formato vira erro', async () => {
        const { doVoid, enviadas } = montar({ deps: { iniciarQuickConnect: vi.fn(async () => ({ codigo: '12a456', segredo: SEGREDO })) } });
        doVoid({ tipo: 'void:entrar' });
        await flush();
        expect(enviadas().at(-1)).toEqual({ tipo: 'mz:login-erro', motivo: 'iniciar' });
    });

    it('void:nao-autorizado descarta o código', async () => {
        const { doVoid, enviadas, deps } = montar();
        doVoid({ tipo: 'void:entrar' });
        await flush();
        doVoid({ tipo: 'void:nao-autorizado' });
        doVoid({ tipo: 'void:autorizado' });
        await flush();
        expect(deps.concluirLogin).not.toHaveBeenCalled();
        expect(enviadas().map(m => m.motivo).filter(Boolean)).toEqual(['nao-autorizado', 'sem-codigo']);
    });

    it('nenhuma mensagem leva o segredo', async () => {
        const { doVoid, enviadas } = montar();
        doVoid({ tipo: 'void:ola' });
        doVoid({ tipo: 'void:entrar' });
        await flush();
        doVoid({ tipo: 'void:autorizado' });
        await flush();
        expect(JSON.stringify(enviadas())).not.toContain(SEGREDO);
    });

    it('desligar tira o ouvinte', () => {
        const { ponte, janela } = montar();
        ponte.desligar();
        expect(janela.removeEventListener).toHaveBeenCalledWith('message', ponte.aoMensagem);
    });
});
