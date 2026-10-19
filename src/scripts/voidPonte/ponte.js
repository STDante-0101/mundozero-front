// Ponte VOID <-> Mundo Zero (PLANO-030 §4.3, versão 1) — núcleo sem dependências.
//
// Liga só quando esta página está dentro de um iframe; fala só com a origem do
// VOID (conferida na chegada e no envio). Fora do VOID (navegador direto, TV,
// celular) não faz nada. O token da sessão e o segredo do Quick Connect NUNCA
// saem desta aba: o VOID só recebe o código de 6 dígitos.

// 2 (Etapa8/016): + controle do player (./player.js), só depois de void:modo.
export const VERSAO_PONTE = 2;
export const ORIGEM_VOID = 'https://tower-1.tail646ed6.ts.net';

// o servidor guarda o código por 10 min (QuickConnectManager, Timeout = 10)
const VALIDADE_CODIGO_MS = 10 * 60 * 1000;

/**
 * @param {object} deps
 * @param {Window} deps.janela - a janela desta página
 * @param {string} [deps.origemVoid]
 * @param {() => {logado: boolean, usuarioId: string|null}} deps.estado
 * @param {() => Promise<{codigo: string, segredo: string}>} deps.iniciarQuickConnect
 * @param {(segredo: string) => Promise<boolean>} deps.consultarQuickConnect
 * @param {(segredo: string) => Promise<string>} deps.concluirLogin - devolve o id do usuário
 * @param {() => Promise<void>} deps.sair
 * @param {() => number} [deps.agora]
 * @param {(enviar: Function) => {receber: (m: object) => boolean}} [deps.criarExtra] - versão 2: o controle do player
 * @returns {{aoMensagem: Function, desligar: Function}|null} null fora de iframe
 */
export function criarPonte({
    janela,
    origemVoid = ORIGEM_VOID,
    estado,
    iniciarQuickConnect,
    consultarQuickConnect,
    concluirLogin,
    sair,
    agora = () => Date.now(),
    criarExtra = null
}) {
    if (!janela?.parent || janela.parent === janela) {
        return null;
    }

    const pai = janela.parent;
    let pendente = null; // o segredo e o prazo do código pendente
    let entrando = false;

    function enviar(tipo, dados) {
        pai.postMessage({ tipo, ...dados }, origemVoid);
    }

    const extra = criarExtra ? criarExtra(enviar) : null;

    function ola() {
        const e = estado();
        enviar('mz:ola', {
            versao: VERSAO_PONTE,
            logado: !!e.logado,
            usuarioId: e.logado ? e.usuarioId : null
        });
    }

    async function entrar() {
        if (entrando) {
            return;
        }
        entrando = true;
        pendente = null;
        try {
            // 1 origem = 1 sessão: logado com outra conta, sai antes
            if (estado().logado) {
                await sair();
            }
            const { codigo, segredo } = await iniciarQuickConnect();
            if (!/^\d{6}$/.test(String(codigo)) || !segredo) {
                throw new Error('resposta do Quick Connect fora do formato');
            }
            pendente = { segredo, ate: agora() + VALIDADE_CODIGO_MS };
            enviar('mz:codigo', { code: String(codigo) });
        } catch {
            pendente = null;
            enviar('mz:login-erro', { motivo: 'iniciar' });
        } finally {
            entrando = false;
        }
    }

    async function autorizado() {
        const p = pendente;
        pendente = null;
        if (!p || agora() > p.ate) {
            enviar('mz:login-erro', { motivo: 'sem-codigo' });
            return;
        }
        try {
            if (!(await consultarQuickConnect(p.segredo))) {
                enviar('mz:login-erro', { motivo: 'nao-autenticado' });
                return;
            }
            const usuarioId = await concluirLogin(p.segredo);
            enviar('mz:login-ok', { usuarioId });
        } catch {
            enviar('mz:login-erro', { motivo: 'concluir' });
        }
    }

    function aoMensagem(ev) {
        if (ev.origin !== origemVoid || ev.source !== pai) {
            return;
        }
        const m = ev.data;
        if (!m || typeof m !== 'object' || typeof m.tipo !== 'string') {
            return;
        }
        switch (m.tipo) {
            case 'void:ola':
                ola();
                break;
            case 'void:entrar':
                entrar();
                break;
            case 'void:autorizado':
                autorizado();
                break;
            case 'void:nao-autorizado':
                pendente = null;
                enviar('mz:login-erro', { motivo: 'nao-autorizado' });
                break;
            default:
                extra?.receber(m);
                break;
        }
    }

    janela.addEventListener('message', aoMensagem);
    // avisa que chegou (o VOID também pergunta com void:ola, para o caso de
    // esta mensagem sair antes de o VOID estar ouvindo)
    ola();

    return {
        aoMensagem,
        desligar: () => janela.removeEventListener('message', aoMensagem)
    };
}
