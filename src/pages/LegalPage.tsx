import React from 'react';
import { FileCheck2, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { BRAND } from '../lib/brand';

const supportEmail = 'brasilportalvip@gmail.com';

export const LegalPage: React.FC = () => {
  const privacy = window.location.pathname.startsWith('/privacidade');

  return (
    <div className="mx-auto max-w-4xl space-y-6 animate-fadeIn pb-12">
      <header className="rounded-3xl border border-blue-500/25 bg-gradient-to-br from-blue-950 via-slate-950 to-cyan-950/30 p-7 md:p-10">
        <div className="flex items-center gap-3">
          {privacy ? <LockKeyhole className="text-cyan-400" size={28} /> : <FileCheck2 className="text-cyan-400" size={28} />}
          <div>
            <span className="text-[10px] font-bold uppercase tracking-[.2em] text-cyan-400">{BRAND.name}</span>
            <h1 className="text-2xl font-black text-white md:text-3xl">
              {privacy ? 'Política de Privacidade' : 'Termos de Uso'}
            </h1>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Versão operacional de produção. Última atualização: 20/08/2026.
        </p>
      </header>

      {privacy ? (
        <div className="froc-panel space-y-7 text-sm leading-relaxed text-slate-300">
          <section>
            <h2 className="froc-section-title mb-2 text-white font-bold text-base">1. Sobre o Froc.IA e Escopo desta Política</h2>
            <p>
              O Froc.IA Marketing Engine é uma plataforma de automação e apoio ao marketing digital desenvolvida para profissionais, agências e empresas. Esta Política de Privacidade descreve como os dados são coletados, utilizados, protegidos, compartilhados e retidos ao utilizar os recursos do Froc.IA, incluindo website, aplicativo web, integrações de redes sociais, geradores de conteúdo e ferramentas de inteligência artificial, em conformidade com as diretrizes da Lei Geral de Proteção de Dados Pessoais (LGPD — Lei nº 13.709/2018).
            </p>
          </section>

          <section>
            <h2 className="froc-section-title mb-2 text-white font-bold text-base">2. Dados Pessoais Tratados</h2>
            <p className="mb-2">O Froc.IA pode coletar e tratar os seguintes tipos de informações:</p>
            <ul className="list-disc pl-5 space-y-1 text-slate-300">
              <li><strong className="text-slate-100">Dados de Cadastro e Conta:</strong> Nome, endereço de e-mail e identificadores atribuídos pela autenticação do usuário.</li>
              <li><strong className="text-slate-100">Dados das Empresas Cadastradas:</strong> Razão social/nome fantasia, segmento, público-alvo, links de website, telefone/WhatsApp de contato, cidade/estado e canais de atendimento cadastrados pelo próprio usuário.</li>
              <li><strong className="text-slate-100">Briefings, Materiais e Conteúdos:</strong> Informações de produtos, serviços, estratégias, parâmetros de campanhas e orientações de marca submetidos para processamento na plataforma.</li>
              <li><strong className="text-slate-100">Conteúdos Criados e Publicações:</strong> Posts, roteiros, artigos, títulos, imagens, cronogramas editoriais e históricos gerados ou agendados.</li>
              <li><strong className="text-slate-100">Dados de Suporte e Atendimento:</strong> Mensagens enviadas aos canais de suporte técnico, solicitações e registros operacionais de atendimento.</li>
              <li><strong className="text-slate-100">Histórico de Créditos e Operações:</strong> Registro das operações realizadas, consumo de créditos, extrato de transações internas e planos contratados.</li>
            </ul>
          </section>

          <section>
            <h2 className="froc-section-title mb-2 text-white font-bold text-base">3. Dados Técnicos, Segurança e Armazenamento Local</h2>
            <p>
              Para assegurar o funcionamento e a segurança do serviço, são registrados dados técnicos como endereço IP, data/hora das requisições, identificadores de sessão, agente de usuário (navegador) e logs operacionais. O Froc.IA utiliza recursos de armazenamento local do navegador (<code className="text-cyan-300 text-xs">localStorage</code> e <code className="text-cyan-300 text-xs">sessionStorage</code>) exclusivamente para reter o estado da interface, preferências de exibição e tokens de autenticação enquanto o usuário estiver logado. Não comercializamos dados de navegação nem empregamos cookies para rastreamento invasivo de terceiros.
            </p>
          </section>

          <section>
            <h2 className="froc-section-title mb-2 text-white font-bold text-base">4. Infraestrutura e Autenticação (Google / Firebase)</h2>
            <p>
              A infraestrutura de banco de dados e autenticação do Froc.IA é provida pelos serviços Google Cloud e Firebase:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2 text-slate-300">
              <li><strong className="text-slate-100">Firebase Authentication:</strong> Gerencia a autenticação segura de usuários. Senhas pessoais de acesso são processadas diretamente pelos mecanismos criptográficos do Firebase e <em>nunca são armazenadas ou visualizadas</em> pelo Froc.IA.</li>
              <li><strong className="text-slate-100">Cloud Firestore:</strong> Armazena os dados operacionais da aplicação, perfis de empresas, histórico de créditos e configurações multi-tenant com regras de isolamento estrito.</li>
              <li><strong className="text-slate-100">Firebase Storage / Assets:</strong> Hospeda arquivos, logos e imagens geradas ou enviadas pelo usuário quando aplicável.</li>
            </ul>
          </section>

          <section>
            <h2 className="froc-section-title mb-2 text-white font-bold text-base">5. Tratamento Pontual de IA (Google Gemini)</h2>
            <p>
              Quando o usuário solicita explicitamente uma operação de geração de conteúdo, estratégia, SEO ou criação visual, os dados estritamente necessários ao briefing daquela operação específica (como tema, segmento e direcionamento de marca) são enviados via API segura para processamento pelos modelos do Google Gemini. 
              O provedor de inteligência artificial <em>não possui acesso irrestrito ao banco de dados</em> da plataforma e os dados transmitidos são delimitados exclusivamente ao contexto da solicitação solicitada pelo usuário no momento da execução.
            </p>
          </section>

          <section>
            <h2 className="froc-section-title mb-2 text-white font-bold text-base">6. Processamento de Pagamentos e Assinaturas (Mercado Pago)</h2>
            <p>
              Transações financeiras, cobranças e assinaturas de planos são processadas diretamente pelo gateway de pagamentos <strong>Mercado Pago</strong>. O Froc.IA recebe apenas a confirmação do pagamento, status da assinatura e identificadores técnicos via webhook assinado criptograficamente. O Froc.IA <em>não armazena números de cartões de crédito, códigos de segurança (CVV) ou dados bancários sensíveis</em> em seus servidores.
            </p>
          </section>

          <section>
            <h2 className="froc-section-title mb-2 text-white font-bold text-base">7. Integrações com Redes Sociais e Protocolo OAuth</h2>
            <p>
              O Froc.IA oferece conectores opcionais via OAuth com plataformas de terceiros, incluindo <strong>Meta (Facebook / Instagram), LinkedIn, Google / YouTube, TikTok, Pinterest e X (Twitter)</strong>:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2 text-slate-300">
              <li>A conexão é sempre iniciada voluntariamente pelo usuário mediante autorização expressa no consentimento oficial do respectivo provedor.</li>
              <li>Tokens de acesso (<code className="text-cyan-300 text-xs">access tokens</code>) e de renovação (<code className="text-cyan-300 text-xs">refresh tokens</code>) recebidos são armazenados no backend com criptografia em repouso e protegidos contra exposição client-side.</li>
              <li>O acesso e as ações realizadas (como agendamento e publicação de posts) limitam-se rigorosamente aos escopos (<code className="text-cyan-300 text-xs">scopes</code>) autorizados pelo usuário.</li>
              <li>A disponibilidade efetiva de cada rede pode depender da conclusão de processos de homologação ou revisão de desenvolvedor exigidos pela respectiva plataforma (como o processo de Developer Review do TikTok ou verificação de aplicativo Meta).</li>
              <li>O usuário pode revogar ou desconectar qualquer integração a qualquer momento pelo painel do Froc.IA ou diretamente nas configurações de segurança de sua conta no provedor externo.</li>
            </ul>
          </section>

          <section>
            <h2 className="froc-section-title mb-2 text-white font-bold text-base">8. Vitrine Pública Froc.IA</h2>
            <p>
              A Vitrine Froc.IA é um diretório público opcional. Os dados de uma empresa (como nome fantasia, descrição pública, links e canais de contato) só são expostos publicamente na internet e incluídos em indexadores (como <code className="text-cyan-300 text-xs">sitemap.xml</code>) se o usuário ativar <em>explicitamente</em> a opção correspondente em seu painel. Empresas com configuração privada não têm suas informações ou páginas públicas expostas a terceiros ou motores de busca.
            </p>
          </section>

          <section>
            <h2 className="froc-section-title mb-2 text-white font-bold text-base">9. Finalidades e Bases Legais do Tratamento</h2>
            <p className="mb-2">Os dados coletados são tratados com base nos princípios de necessidade, finalidade e boa-fé da LGPD para as seguintes finalidades:</p>
            <ul className="list-disc pl-5 space-y-1 text-slate-300">
              <li>Execução dos serviços contratados e cumprimento dos Termos de Uso (geração de conteúdo, gerenciamento de marca e agendamento).</li>
              <li>Autenticação de identidade, controle de acesso e proteção da segurança da conta.</li>
              <li>Processamento de pagamentos, cobranças, controle de carteira de créditos e combate a fraudes.</li>
              <li>Prestação de suporte técnico, resolução de incidentes e comunicação operacional.</li>
              <li>Cumprimento de obrigações legais, regulatórias ou fiscais aplicáveis.</li>
            </ul>
          </section>

          <section>
            <h2 className="froc-section-title mb-2 text-white font-bold text-base">10. Compartilhamento Estritamente Necessário com Prestadores</h2>
            <p>
              O Froc.IA não comercializa dados pessoais com corretores de dados ou anunciantes. O compartilhamento ocorre exclusivamente com parceiros e prestadores de infraestrutura essenciais para a operação técnica da plataforma:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2 text-slate-300">
              <li><strong>Google Cloud / Firebase:</strong> Hospedagem, banco de dados e autenticação segura.</li>
              <li><strong>Google Gemini API:</strong> Inferência pontual de modelos de linguagem e geração visual solicitada.</li>
              <li><strong>Mercado Pago:</strong> Processamento seguro de pagamentos e assinaturas.</li>
              <li><strong>APIs Oficiais de Redes Sociais:</strong> Transmissão de publicações autorizadas pelo usuário.</li>
            </ul>
          </section>

          <section>
            <h2 className="froc-section-title mb-2 text-white font-bold text-base">11. Segurança e Medidas Técnicas</h2>
            <p>
              Adotamos medidas técnicas e organizacionais adequadas para proteger os dados contra acessos não autorizados, perda acidental, destruição ou alteração indevida. Isso inclui comunicações em trânsito com criptografia TLS/HTTPS obrigatória, segregação de segredos e credenciais em ambiente de backend, criptografia simétrica para tokens OAuth sensíveis em repouso e isolamento multi-tenant por usuário no banco de dados. Ressaltamos que nenhum ambiente conectado à internet oferece segurança matemática absoluta, mantendo o compromisso de aprimoramento contínuo das defesas do sistema.
            </p>
          </section>

          <section>
            <h2 className="froc-section-title mb-2 text-white font-bold text-base">12. Retenção e Ciclo de Vida dos Dados</h2>
            <p>
              Os dados são armazenados pelo período em que a conta do usuário permanecer ativa e enquanto necessários para cumprir as finalidades descritas nesta Política. Dados vinculados a transações financeiras, históricos de créditos e registros de auditoria podem ser retidos pelos prazos exigidos pela legislação fiscal, civil e regulatória brasileira, mesmo após o encerramento do uso do serviço.
            </p>
          </section>

          <section>
            <h2 className="froc-section-title mb-2 text-white font-bold text-base">13. Exclusão de Dados e Solicitações de Titulares</h2>
            <p>
              O usuário pode excluir individualmente empresas, conteúdos criados e campanhas diretamente pela interface do aplicativo. Para solicitações de exclusão definitiva da conta, exportação de dados ou revogação de consentimento, o titular pode enviar sua solicitação para o canal oficial de privacidade: <strong className="text-cyan-300">brasilportalvip@gmail.com</strong>. Os pedidos serão analisados e processados nos prazos razoáveis estabelecidos pela LGPD, ressalvadas as hipóteses de retenção autorizadas por lei.
            </p>
          </section>

          <section>
            <h2 className="froc-section-title mb-2 text-white font-bold text-base">14. Direitos dos Titulares de Dados (LGPD)</h2>
            <p className="mb-2">Nos termos da Lei nº 13.709/2018, o titular de dados tem o direito de solicitar a qualquer momento:</p>
            <ul className="list-disc pl-5 space-y-1 text-slate-300">
              <li>Confirmação da existência de tratamento de seus dados pessoais.</li>
              <li>Acesso aos dados tratados pela plataforma.</li>
              <li>Correção de dados incompletos, inexatos ou desatualizados.</li>
              <li>Anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade.</li>
              <li>Portabilidade dos dados a outro fornecedor de serviço, mediante requisição expressa e observados os segredos comerciais.</li>
              <li>Informações sobre as entidades públicas e privadas com as quais houve compartilhamento.</li>
              <li>Revogação do consentimento concedido anteriormente para finalidades específicas.</li>
            </ul>
          </section>

          <section>
            <h2 className="froc-section-title mb-2 text-white font-bold text-base">15. Crianças e Adolescentes</h2>
            <p>
              O Froc.IA é uma ferramenta profissional voltada para pessoas capazes, empreendedores e organizações empresariais. Não coletamos intencionalmente dados de crianças ou menores de 18 anos. Caso seja identificada a criação de conta por menor sem representação legal, os dados correspondentes serão prontamente removidos.
            </p>
          </section>

          <section>
            <h2 className="froc-section-title mb-2 text-white font-bold text-base">16. Links para Serviços de Terceiros</h2>
            <p>
              A plataforma pode conter links para sites externos ou permitir integrações com ferramentas de terceiros cujas práticas de privacidade são regidas por suas próprias políticas. Recomendamos a leitura dos termos e políticas de privacidade de cada serviço externo conectado.
            </p>
          </section>

          <section>
            <h2 className="froc-section-title mb-2 text-white font-bold text-base">17. Alterações desta Política e Canal de Contato</h2>
            <p>
              Esta Política de Privacidade poderá ser atualizada periodicamente para refletir melhorias funcionais, novas integrações ou adequações normativas. A data da última versão estará sempre indicada no topo deste documento.
            </p>
          </section>
        </div>
      ) : (
        <div className="froc-panel space-y-6 text-sm leading-7 text-slate-300">
          <section>
            <h2 className="froc-section-title mb-2 text-white font-bold text-base">1. Serviço</h2>
            <p>
              O Froc.IA é uma plataforma de automação de marketing com recursos de inteligência artificial, criação de conteúdo, SEO, campanhas, calendário, integrações sociais, créditos e ferramentas relacionadas. Recursos podem depender de provedores externos e das permissões concedidas pelo usuário.
            </p>
          </section>
          <section>
            <h2 className="froc-section-title mb-2 text-white font-bold text-base">2. Conta e segurança</h2>
            <p>
              O usuário deve manter seus meios de acesso seguros e utilizar informações verdadeiras. É proibido tentar acessar contas, dados, integrações ou áreas administrativas sem autorização.
            </p>
          </section>
          <section>
            <h2 className="froc-section-title mb-2 text-white font-bold text-base">3. Inteligência artificial</h2>
            <p>
              Conteúdo gerado por IA deve ser revisado antes de uso comercial, jurídico, médico, financeiro ou em qualquer contexto sensível. A plataforma reduz respostas inventadas por instrução e validação, mas não garante que toda saída de IA seja perfeita.
            </p>
          </section>
          <section>
            <h2 className="froc-section-title mb-2 text-white font-bold text-base">4. Créditos, planos e pagamentos</h2>
            <p>
              Operações de IA consomem créditos conforme o catálogo exibido no produto. Em modo de assinatura, a renovação e cobrança são processadas pelo Mercado Pago; cancelamentos interrompem renovações futuras conforme o status confirmado pelo provedor. Estornos ou chargebacks podem gerar reversão dos créditos concedidos naquela cobrança.
            </p>
          </section>
          <section>
            <h2 className="froc-section-title mb-2 text-white font-bold text-base">5. Redes sociais e Autopilot</h2>
            <p>
              Publicações automáticas só são executadas em contas conectadas por OAuth e quando a API oficial da rede permitir o formato solicitado. O Froc.IA não considera uma publicação concluída quando o provedor retorna erro ou quando uma integração necessária não está configurada.
            </p>
          </section>
          <section>
            <h2 className="froc-section-title mb-2 text-white font-bold text-base">6. Uso aceitável</h2>
            <p>
              Não é permitido usar o serviço para fraude, spam abusivo, violação de direitos autorais, falsificação de avaliações, conteúdo ilegal ou tentativa de contornar limites, segurança ou regras das plataformas integradas.
            </p>
          </section>
          <section>
            <h2 className="froc-section-title mb-2 text-white font-bold text-base">7. Disponibilidade</h2>
            <p>
              Integrações podem sofrer alterações, indisponibilidades ou revisão de permissões pelos respectivos provedores. O Froc.IA deve informar falhas reais em vez de simular sucesso.
            </p>
          </section>
        </div>
      )}

      <div className="froc-panel flex items-start gap-3 text-xs text-slate-400">
        <ShieldCheck className="shrink-0 text-cyan-400 mt-0.5" size={20} />
        <div>
          <div className="font-bold text-white text-sm">Canal Oficial de Atendimento e Privacidade</div>
          <p className="mt-1 text-slate-300">
            Para dúvidas sobre estes documentos, solicitações de privacidade, exercício de direitos de titular ou suporte técnico:
          </p>
          <a href={`mailto:${supportEmail}`} className="mt-2 inline-flex items-center gap-1.5 text-cyan-300 hover:text-cyan-200 font-semibold transition-colors">
            <Mail size={14} /> {supportEmail}
          </a>
        </div>
      </div>
    </div>
  );
};
