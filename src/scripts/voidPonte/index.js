// Ponte VOID <-> Mundo Zero (PLANO-030 §4.3): liga o núcleo (./ponte.js) ao
// jellyfin-web. Usa o MESMO caminho do botão "Quick Connect" da tela de login
// (controllers/session/login): Initiate -> Connect -> apiClient.quickConnect.

import { ServerConnections } from 'lib/jellyfin-apiclient';

import viewContainer from '../../components/viewContainer';
import { navigate, onServerChanged } from '../../utils/dashboard';
import { queryClient } from '../../utils/query/queryClient';
import { criarPonte } from './ponte';

function apiClient() {
    return ServerConnections.currentApiClient();
}

export function iniciarPonteVoid() {
    return criarPonte({
        janela: window,
        estado: () => {
            const api = apiClient();
            const usuarioId = api?.getCurrentUserId() || null;
            return { logado: !!(api?.accessToken() && usuarioId), usuarioId };
        },
        iniciarQuickConnect: async () => {
            const api = apiClient();
            const json = await api.ajax({ type: 'POST', url: api.getUrl('/QuickConnect/Initiate') }, true)
                .then(res => res.json());
            return { codigo: json.Code, segredo: json.Secret };
        },
        consultarQuickConnect: async (segredo) => {
            const api = apiClient();
            const data = await api.getJSON(api.getUrl('/QuickConnect/Connect?Secret=' + encodeURIComponent(segredo)));
            return !!data?.Authenticated;
        },
        concluirLogin: async (segredo) => {
            const api = apiClient();
            const result = await api.quickConnect(segredo);
            onServerChanged(result.User.Id, result.AccessToken, api);
            await navigate('home');
            return result.User.Id;
        },
        sair: async () => {
            await ServerConnections.logout();
            queryClient.clear();
            viewContainer.reset();
        }
    });
}
