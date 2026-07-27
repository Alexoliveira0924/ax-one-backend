const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("./axsystem.db", (err) => {

    if (err) {

        console.error("Erro ao conectar ao banco:", err.message);

    } else {

        console.log("Banco de dados conectado!");

        db.run("ALTER TABLE emprestimos ADD COLUMN emprestimo_origem_id INTEGER", (err) => {
    if (err && !err.message.includes("duplicate column")) console.log(err.message);
});

db.run("ALTER TABLE emprestimos ADD COLUMN emprestimo_filho_id INTEGER", (err) => {
    if (err && !err.message.includes("duplicate column")) console.log(err.message);
});

db.run("ALTER TABLE emprestimos ADD COLUMN tipo_emprestimo TEXT DEFAULT 'parcelas_fixas'", (err) => {
    if (err && !err.message.includes("duplicate column")) console.log(err.message);
});

db.run("ALTER TABLE emprestimos ADD COLUMN criadoEm TEXT", (err) => {
    if (err && !err.message.includes("duplicate column")) console.log(err.message);
});

        // ==========================
        // TABELA CLIENTES
        // ==========================

        db.run(`
            CREATE TABLE IF NOT EXISTS clientes (

                id INTEGER PRIMARY KEY AUTOINCREMENT,

                codigo TEXT,

                nome TEXT NOT NULL,

                cpf TEXT,

                telefone TEXT,

                email TEXT,

                cidade TEXT,

                observacao TEXT,

                status TEXT

            )
        `);

        // ==========================
        // TABELA EMPRÉSTIMOS
        // ==========================

        db.run(`
CREATE TABLE IF NOT EXISTS emprestimos (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    contrato TEXT,

    cliente TEXT,

    valor REAL,

    juros REAL,

    parcelas INTEGER,

    dataEmprestimo TEXT,

    primeiroVencimento TEXT,

    observacoes TEXT,

    status TEXT DEFAULT 'Ativo',

    emprestimo_origem_id INTEGER,

    emprestimo_filho_id INTEGER,

    tipo_emprestimo TEXT DEFAULT 'parcelas_fixas'

)
`);

// =========================
// TABELA PAGAMENTOS
// =========================

        db.run(`
CREATE TABLE IF NOT EXISTS pagamentos (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    emprestimo_id INTEGER NOT NULL,

    parcela INTEGER NOT NULL,

    vencimento TEXT,

    data_pagamento TEXT,

    valor REAL,

    status TEXT DEFAULT 'Pendente',

    observacoes TEXT,

    FOREIGN KEY (emprestimo_id) REFERENCES emprestimos(id)

)
`);

// ==============================
// TABELA RECEBIMENTOS DE PARCELAS
// ==============================

db.run(`
  CREATE TABLE IF NOT EXISTS recebimentos_parcelas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    pagamento_id INTEGER NOT NULL,

    data_recebimento TEXT NOT NULL,

    valor_recebido REAL NOT NULL DEFAULT 0,

    juros REAL NOT NULL DEFAULT 0,

    multa REAL NOT NULL DEFAULT 0,

    desconto REAL NOT NULL DEFAULT 0,

    observacoes TEXT,

    criado_em TEXT DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (pagamento_id) REFERENCES pagamentos(id)
  )

`);

// ==========================================
// GARANTIR CAMPO TIPO EM RECEBIMENTOS
// ==========================================

db.all(
  `PRAGMA table_info(recebimentos_parcelas)`,
  [],
  (erro, colunas) => {
    if (erro) {
      console.error(
        "Erro ao verificar tabela recebimentos_parcelas:",
        erro
      );
      return;
    }

    const possuiCampoTipo = colunas.some(
      (coluna) => coluna.name === "tipo"
    );

    if (!possuiCampoTipo) {
      db.run(
        `
          ALTER TABLE recebimentos_parcelas
          ADD COLUMN tipo TEXT NOT NULL DEFAULT 'Parcela'
        `,
        (erroAlteracao) => {
          if (erroAlteracao) {
            console.error(
              "Erro ao adicionar campo tipo:",
              erroAlteracao
            );
            return;
          }

          console.log(
            "Campo tipo adicionado em recebimentos_parcelas."
          );
        }
      );
    }
  }
);

// =========================
// TABELA RENEGOCIAÇÕES
// =========================

db.run(`
CREATE TABLE IF NOT EXISTS renegociacoes (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    emprestimo_origem INTEGER,

    emprestimo_novo INTEGER,

    data TEXT,

    saldo_devedor REAL,

    nova_taxa REAL,

    novas_parcelas INTEGER,

    observacao TEXT

)
`);

// =========================
// TABELA MOVIMENTAÇÕES
// =========================

db.run(`
CREATE TABLE IF NOT EXISTS movimentacoes (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    emprestimo_id INTEGER NOT NULL,

    data TEXT,

    hora TEXT,

    tipo TEXT,

    descricao TEXT,

    valor REAL,

    usuario TEXT,

    FOREIGN KEY (emprestimo_id)
        REFERENCES emprestimos(id)

)
`);

// ====================================
// TABELA EXTRATO DO CONTRATO
// ====================================

db.run(
    `
    CREATE TABLE IF NOT EXISTS extrato_contrato (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        emprestimo_id INTEGER NOT NULL,
        data TEXT NOT NULL,
        hora TEXT NOT NULL,
        tipo TEXT NOT NULL,
        descricao TEXT,
        valor REAL DEFAULT 0,
        saldo REAL DEFAULT 0,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (emprestimo_id)
            REFERENCES emprestimos(id)
    )
    `,
    err => {
        if (err) {
            console.error(
                "Erro ao criar tabela extrato_contrato:",
                err.message
            );
        } else {
            console.log(
                "Tabela extrato_contrato pronta!"
            );
        }
    }
);

        // ==========================================
        // MÓDULO: ANTECIPAÇÃO DE NOTAS FISCAIS
        // ==========================================
        // Toda tabela do módulo já nasce com tenant_id (multi-tenant
        // futuro — hoje sempre 1, a própria AX Holding) para não exigir
        // migração de schema quando o produto virar SaaS multi-empresa.

        // ==========================
        // TABELA EMPRESAS CEDENTES
        // ==========================

        // Índices só são criados dentro do callback de sucesso do CREATE
        // TABLE correspondente — sem isso, um db.run() solto não tem
        // garantia de rodar depois que a tabela existe (sqlite3 não
        // serializa automaticamente fora de db.serialize()), e um erro
        // nele, sem callback, derruba o processo inteiro.
        db.run(
            `
            CREATE TABLE IF NOT EXISTS empresas_cedentes (

                id INTEGER PRIMARY KEY AUTOINCREMENT,

                tenant_id INTEGER NOT NULL DEFAULT 1,

                razao_social TEXT NOT NULL,

                nome_fantasia TEXT,

                cnpj TEXT NOT NULL UNIQUE,

                inscricao_estadual TEXT,

                contato_nome TEXT,

                contato_telefone TEXT,

                contato_email TEXT,

                endereco TEXT,

                banco TEXT,

                agencia TEXT,

                conta TEXT,

                tipo_conta TEXT,

                pix TEXT,

                limite_credito REAL DEFAULT 0,

                taxa_padrao REAL,

                status TEXT NOT NULL DEFAULT 'Ativa',

                observacoes TEXT,

                criado_em TEXT,

                atualizado_em TEXT

            )
            `,
            err => {
                if (err) {
                    console.error(
                        "Erro ao criar tabela empresas_cedentes:",
                        err.message
                    );
                    return;
                }

                console.log("Tabela empresas_cedentes pronta!");

                db.run(
                    "CREATE INDEX IF NOT EXISTS idx_empresas_cedentes_cnpj ON empresas_cedentes(cnpj)",
                    erroIndice => {
                        if (erroIndice) {
                            console.error(
                                "Erro ao criar índice idx_empresas_cedentes_cnpj:",
                                erroIndice.message
                            );
                        }
                    }
                );

                db.run(
                    "CREATE INDEX IF NOT EXISTS idx_empresas_cedentes_tenant ON empresas_cedentes(tenant_id)",
                    erroIndice => {
                        if (erroIndice) {
                            console.error(
                                "Erro ao criar índice idx_empresas_cedentes_tenant:",
                                erroIndice.message
                            );
                        }
                    }
                );
            }
        );

        // ==========================
        // TABELA SACADOS
        // ==========================
        // score_risco e total_atrasos não são colunas — são calculados na
        // leitura a partir de notas_fiscais/recebimentos_nf quando essas
        // tabelas existirem (Etapas 5 e 6), do mesmo jeito que "Vencida"
        // nunca é uma coluna gravada.

        db.run(
            `
            CREATE TABLE IF NOT EXISTS sacados (

                id INTEGER PRIMARY KEY AUTOINCREMENT,

                tenant_id INTEGER NOT NULL DEFAULT 1,

                nome TEXT NOT NULL,

                cnpj_cpf TEXT NOT NULL UNIQUE,

                contato_telefone TEXT,

                contato_email TEXT,

                limite_credito REAL DEFAULT 0,

                status TEXT DEFAULT 'Ativa',

                observacoes TEXT,

                criado_em TEXT,

                atualizado_em TEXT

            )
            `,
            err => {
                if (err) {
                    console.error(
                        "Erro ao criar tabela sacados:",
                        err.message
                    );
                    return;
                }

                console.log("Tabela sacados pronta!");

                // limite_credito/status nasceram só na Etapa Frontend 2 —
                // ALTER TABLE aninhado aqui (não em index.js) para garantir
                // que só rode depois que a tabela sacados existe de fato;
                // cobre bancos que já existiam antes dessas colunas serem
                // adicionadas ao CREATE TABLE acima. "duplicate column name"
                // é o caso normal em bancos novos (coluna já veio no CREATE).
                db.run(
                    "ALTER TABLE sacados ADD COLUMN limite_credito REAL DEFAULT 0",
                    erroAlter => {
                        if (erroAlter && !erroAlter.message.includes("duplicate column name")) {
                            console.error(
                                "Erro ao criar coluna limite_credito em sacados:",
                                erroAlter.message
                            );
                        }
                    }
                );

                db.run(
                    "ALTER TABLE sacados ADD COLUMN status TEXT DEFAULT 'Ativa'",
                    erroAlter => {
                        if (erroAlter && !erroAlter.message.includes("duplicate column name")) {
                            console.error(
                                "Erro ao criar coluna status em sacados:",
                                erroAlter.message
                            );
                        }

                        db.run(
                            "UPDATE sacados SET status = 'Ativa' WHERE status IS NULL",
                            erroUpdate => {
                                if (erroUpdate) {
                                    console.error(
                                        "Erro ao popular status em sacados:",
                                        erroUpdate.message
                                    );
                                }
                            }
                        );
                    }
                );

                db.run(
                    "CREATE INDEX IF NOT EXISTS idx_sacados_cnpj_cpf ON sacados(cnpj_cpf)",
                    erroIndice => {
                        if (erroIndice) {
                            console.error(
                                "Erro ao criar índice idx_sacados_cnpj_cpf:",
                                erroIndice.message
                            );
                        }
                    }
                );

                db.run(
                    "CREATE INDEX IF NOT EXISTS idx_sacados_tenant ON sacados(tenant_id)",
                    erroIndice => {
                        if (erroIndice) {
                            console.error(
                                "Erro ao criar índice idx_sacados_tenant:",
                                erroIndice.message
                            );
                        }
                    }
                );
            }
        );

        // ==========================
        // TABELA COMISSIONADOS
        // ==========================

        db.run(
            `
            CREATE TABLE IF NOT EXISTS comissionados (

                id INTEGER PRIMARY KEY AUTOINCREMENT,

                tenant_id INTEGER NOT NULL DEFAULT 1,

                nome TEXT NOT NULL,

                cpf_cnpj TEXT NOT NULL UNIQUE,

                tipo TEXT NOT NULL DEFAULT 'Interno',

                contato_telefone TEXT,

                contato_email TEXT,

                banco TEXT,

                agencia TEXT,

                conta TEXT,

                pix TEXT,

                status TEXT NOT NULL DEFAULT 'Ativo',

                observacoes TEXT,

                criado_em TEXT,

                atualizado_em TEXT

            )
            `,
            err => {
                if (err) {
                    console.error(
                        "Erro ao criar tabela comissionados:",
                        err.message
                    );
                    return;
                }

                console.log("Tabela comissionados pronta!");

                db.run(
                    "CREATE INDEX IF NOT EXISTS idx_comissionados_cpf_cnpj ON comissionados(cpf_cnpj)",
                    erroIndice => {
                        if (erroIndice) {
                            console.error(
                                "Erro ao criar índice idx_comissionados_cpf_cnpj:",
                                erroIndice.message
                            );
                        }
                    }
                );

                db.run(
                    "CREATE INDEX IF NOT EXISTS idx_comissionados_tenant ON comissionados(tenant_id)",
                    erroIndice => {
                        if (erroIndice) {
                            console.error(
                                "Erro ao criar índice idx_comissionados_tenant:",
                                erroIndice.message
                            );
                        }
                    }
                );
            }
        );

        // ==========================
        // TABELA OPERAÇÕES DE ANTECIPAÇÃO
        // ==========================
        // valor_face, deságio, valor líquido e lucro NÃO são colunas —
        // são derivados de notas_fiscais (Etapa 5 em diante), mesma razão
        // de valor_a_receber nunca ter sido uma coluna confiável em
        // emprestimos. Aqui a tabela guarda só o que é dado próprio da
        // operação.

        db.run(
            `
            CREATE TABLE IF NOT EXISTS operacoes_antecipacao (

                id INTEGER PRIMARY KEY AUTOINCREMENT,

                tenant_id INTEGER NOT NULL DEFAULT 1,

                numero_operacao TEXT NOT NULL UNIQUE,

                empresa_cedente_id INTEGER NOT NULL,

                data_operacao TEXT,

                taxa REAL,

                modalidade_taxa TEXT NOT NULL DEFAULT 'mensal',

                prazo_dias INTEGER,

                status TEXT NOT NULL DEFAULT 'Em Análise',

                responsavel TEXT,

                observacoes TEXT,

                criado_em TEXT,

                atualizado_em TEXT,

                FOREIGN KEY (empresa_cedente_id)
                    REFERENCES empresas_cedentes(id)

            )
            `,
            err => {
                if (err) {
                    console.error(
                        "Erro ao criar tabela operacoes_antecipacao:",
                        err.message
                    );
                    return;
                }

                console.log("Tabela operacoes_antecipacao pronta!");

                db.run(
                    "CREATE INDEX IF NOT EXISTS idx_operacoes_nf_empresa ON operacoes_antecipacao(empresa_cedente_id)",
                    erroIndice => {
                        if (erroIndice) {
                            console.error(
                                "Erro ao criar índice idx_operacoes_nf_empresa:",
                                erroIndice.message
                            );
                        }
                    }
                );

                db.run(
                    "CREATE INDEX IF NOT EXISTS idx_operacoes_nf_status ON operacoes_antecipacao(status)",
                    erroIndice => {
                        if (erroIndice) {
                            console.error(
                                "Erro ao criar índice idx_operacoes_nf_status:",
                                erroIndice.message
                            );
                        }
                    }
                );

                db.run(
                    "CREATE INDEX IF NOT EXISTS idx_operacoes_nf_tenant ON operacoes_antecipacao(tenant_id)",
                    erroIndice => {
                        if (erroIndice) {
                            console.error(
                                "Erro ao criar índice idx_operacoes_nf_tenant:",
                                erroIndice.message
                            );
                        }
                    }
                );
            }
        );

        // ==========================
        // TABELA NOTAS FISCAIS
        // ==========================
        // "situação" não é coluna: Cancelada é a única coisa que precisa
        // ser gravada (ação explícita); Recebida/Vencida/Em Aberto são
        // sempre calculadas na leitura (Recebida depende de
        // recebimentos_nf, que chega na Etapa 6).

        db.run(
            `
            CREATE TABLE IF NOT EXISTS notas_fiscais (

                id INTEGER PRIMARY KEY AUTOINCREMENT,

                tenant_id INTEGER NOT NULL DEFAULT 1,

                operacao_id INTEGER NOT NULL,

                numero_nf TEXT NOT NULL,

                serie TEXT,

                chave_acesso TEXT,

                data_emissao TEXT,

                data_vencimento TEXT NOT NULL,

                valor REAL NOT NULL,

                sacado_id INTEGER NOT NULL,

                cancelada INTEGER NOT NULL DEFAULT 0,

                observacoes TEXT,

                criado_em TEXT,

                atualizado_em TEXT,

                FOREIGN KEY (operacao_id)
                    REFERENCES operacoes_antecipacao(id),

                FOREIGN KEY (sacado_id)
                    REFERENCES sacados(id)

            )
            `,
            err => {
                if (err) {
                    console.error(
                        "Erro ao criar tabela notas_fiscais:",
                        err.message
                    );
                    return;
                }

                console.log("Tabela notas_fiscais pronta!");

                db.run(
                    "CREATE INDEX IF NOT EXISTS idx_notas_fiscais_operacao ON notas_fiscais(operacao_id)",
                    erroIndice => {
                        if (erroIndice) {
                            console.error(
                                "Erro ao criar índice idx_notas_fiscais_operacao:",
                                erroIndice.message
                            );
                        }
                    }
                );

                db.run(
                    "CREATE INDEX IF NOT EXISTS idx_notas_fiscais_sacado ON notas_fiscais(sacado_id)",
                    erroIndice => {
                        if (erroIndice) {
                            console.error(
                                "Erro ao criar índice idx_notas_fiscais_sacado:",
                                erroIndice.message
                            );
                        }
                    }
                );

                db.run(
                    "CREATE INDEX IF NOT EXISTS idx_notas_fiscais_vencimento ON notas_fiscais(data_vencimento)",
                    erroIndice => {
                        if (erroIndice) {
                            console.error(
                                "Erro ao criar índice idx_notas_fiscais_vencimento:",
                                erroIndice.message
                            );
                        }
                    }
                );

                db.run(
                    "CREATE INDEX IF NOT EXISTS idx_notas_fiscais_tenant ON notas_fiscais(tenant_id)",
                    erroIndice => {
                        if (erroIndice) {
                            console.error(
                                "Erro ao criar índice idx_notas_fiscais_tenant:",
                                erroIndice.message
                            );
                        }
                    }
                );
            }
        );

        // ==========================
        // TABELA RECEBIMENTOS DE NF
        // ==========================
        // Mesma lição já aplicada (e corrigida) em recebimentos_parcelas:
        // "tipo" existe desde o primeiro dia para separar o que reduz o
        // saldo da NF (Recebimento) do que é receita à parte e não reduz
        // (Juros, Multa) — sem colunas juros/multa soltas e nunca
        // preenchidas, que foi o problema original em Empréstimos.
        // criado_em guarda o instante real (auditoria); data_recebimento é
        // a data de negócio informada por quem lança.

        db.run(
            `
            CREATE TABLE IF NOT EXISTS recebimentos_nf (

                id INTEGER PRIMARY KEY AUTOINCREMENT,

                tenant_id INTEGER NOT NULL DEFAULT 1,

                nota_fiscal_id INTEGER NOT NULL,

                data_recebimento TEXT NOT NULL,

                valor_recebido REAL NOT NULL DEFAULT 0,

                tipo TEXT NOT NULL DEFAULT 'Recebimento',

                desconto REAL NOT NULL DEFAULT 0,

                usuario TEXT,

                observacoes TEXT,

                criado_em TEXT,

                FOREIGN KEY (nota_fiscal_id)
                    REFERENCES notas_fiscais(id)

            )
            `,
            err => {
                if (err) {
                    console.error(
                        "Erro ao criar tabela recebimentos_nf:",
                        err.message
                    );
                    return;
                }

                console.log("Tabela recebimentos_nf pronta!");

                db.run(
                    "CREATE INDEX IF NOT EXISTS idx_recebimentos_nf_nota ON recebimentos_nf(nota_fiscal_id)",
                    erroIndice => {
                        if (erroIndice) {
                            console.error(
                                "Erro ao criar índice idx_recebimentos_nf_nota:",
                                erroIndice.message
                            );
                        }
                    }
                );

                db.run(
                    "CREATE INDEX IF NOT EXISTS idx_recebimentos_nf_data ON recebimentos_nf(data_recebimento)",
                    erroIndice => {
                        if (erroIndice) {
                            console.error(
                                "Erro ao criar índice idx_recebimentos_nf_data:",
                                erroIndice.message
                            );
                        }
                    }
                );

                db.run(
                    "CREATE INDEX IF NOT EXISTS idx_recebimentos_nf_tenant ON recebimentos_nf(tenant_id)",
                    erroIndice => {
                        if (erroIndice) {
                            console.error(
                                "Erro ao criar índice idx_recebimentos_nf_tenant:",
                                erroIndice.message
                            );
                        }
                    }
                );
            }
        );

        // ==========================
        // TABELA COMISSÕES DA OPERAÇÃO
        // ==========================
        // valor_calculado é um retrato tirado na criação (ou numa edição
        // enquanto ainda está Pendente/Aprovada) — não recalcula sozinho
        // conforme o deságio da operação muda, senão o valor combinado
        // com o comissionado ficaria instável. Paga/Cancelada travam tudo,
        // mesma disciplina de NF com recebimento.

        db.run(
            `
            CREATE TABLE IF NOT EXISTS comissoes_operacao (

                id INTEGER PRIMARY KEY AUTOINCREMENT,

                tenant_id INTEGER NOT NULL DEFAULT 1,

                operacao_id INTEGER NOT NULL,

                comissionado_id INTEGER NOT NULL,

                tipo_comissao TEXT NOT NULL DEFAULT 'percentual',

                base_calculo TEXT NOT NULL DEFAULT 'desagio',

                percentual REAL,

                valor_fixo REAL,

                valor_calculado REAL NOT NULL DEFAULT 0,

                status TEXT NOT NULL DEFAULT 'Pendente',

                data_pagamento TEXT,

                usuario TEXT,

                observacoes TEXT,

                criado_em TEXT,

                atualizado_em TEXT,

                FOREIGN KEY (operacao_id)
                    REFERENCES operacoes_antecipacao(id),

                FOREIGN KEY (comissionado_id)
                    REFERENCES comissionados(id)

            )
            `,
            err => {
                if (err) {
                    console.error(
                        "Erro ao criar tabela comissoes_operacao:",
                        err.message
                    );
                    return;
                }

                console.log("Tabela comissoes_operacao pronta!");

                db.run(
                    "CREATE INDEX IF NOT EXISTS idx_comissoes_operacao_operacao ON comissoes_operacao(operacao_id)",
                    erroIndice => {
                        if (erroIndice) {
                            console.error(
                                "Erro ao criar índice idx_comissoes_operacao_operacao:",
                                erroIndice.message
                            );
                        }
                    }
                );

                db.run(
                    "CREATE INDEX IF NOT EXISTS idx_comissoes_operacao_comissionado ON comissoes_operacao(comissionado_id)",
                    erroIndice => {
                        if (erroIndice) {
                            console.error(
                                "Erro ao criar índice idx_comissoes_operacao_comissionado:",
                                erroIndice.message
                            );
                        }
                    }
                );

                db.run(
                    "CREATE INDEX IF NOT EXISTS idx_comissoes_operacao_status ON comissoes_operacao(status)",
                    erroIndice => {
                        if (erroIndice) {
                            console.error(
                                "Erro ao criar índice idx_comissoes_operacao_status:",
                                erroIndice.message
                            );
                        }
                    }
                );

                db.run(
                    "CREATE INDEX IF NOT EXISTS idx_comissoes_operacao_tenant ON comissoes_operacao(tenant_id)",
                    erroIndice => {
                        if (erroIndice) {
                            console.error(
                                "Erro ao criar índice idx_comissoes_operacao_tenant:",
                                erroIndice.message
                            );
                        }
                    }
                );
            }
        );

        // ==========================
        // TABELA CUSTOS DA OPERAÇÃO
        // ==========================
        // Mesma disciplina de comissoes_operacao: Pago/Cancelado são
        // terminais. A diferença de negócio é o "responsavel_custo" —
        // é ele que decide se o custo pago desconta do repasse (Cedente)
        // ou só do lucro líquido da AX (AX Holding); nunca do lucro bruto.

        db.run(
            `
            CREATE TABLE IF NOT EXISTS custos_operacao (

                id INTEGER PRIMARY KEY AUTOINCREMENT,

                tenant_id INTEGER NOT NULL DEFAULT 1,

                operacao_id INTEGER NOT NULL,

                categoria TEXT NOT NULL,

                descricao TEXT,

                valor REAL NOT NULL,

                responsavel_custo TEXT NOT NULL DEFAULT 'AX Holding',

                status TEXT NOT NULL DEFAULT 'Pendente',

                data_pagamento TEXT,

                usuario TEXT,

                observacoes TEXT,

                criado_em TEXT,

                atualizado_em TEXT,

                FOREIGN KEY (operacao_id)
                    REFERENCES operacoes_antecipacao(id)

            )
            `,
            err => {
                if (err) {
                    console.error(
                        "Erro ao criar tabela custos_operacao:",
                        err.message
                    );
                    return;
                }

                console.log("Tabela custos_operacao pronta!");

                db.run(
                    "CREATE INDEX IF NOT EXISTS idx_custos_operacao_operacao ON custos_operacao(operacao_id)",
                    erroIndice => {
                        if (erroIndice) {
                            console.error(
                                "Erro ao criar índice idx_custos_operacao_operacao:",
                                erroIndice.message
                            );
                        }
                    }
                );

                db.run(
                    "CREATE INDEX IF NOT EXISTS idx_custos_operacao_status ON custos_operacao(status)",
                    erroIndice => {
                        if (erroIndice) {
                            console.error(
                                "Erro ao criar índice idx_custos_operacao_status:",
                                erroIndice.message
                            );
                        }
                    }
                );

                db.run(
                    "CREATE INDEX IF NOT EXISTS idx_custos_operacao_tenant ON custos_operacao(tenant_id)",
                    erroIndice => {
                        if (erroIndice) {
                            console.error(
                                "Erro ao criar índice idx_custos_operacao_tenant:",
                                erroIndice.message
                            );
                        }
                    }
                );
            }
        );

        // ==========================
        // TABELA REPASSES
        // ==========================
        // Uma linha por operação (operacao_id é UNIQUE) — é a etapa
        // definitiva do cálculo financeiro, então guarda um retrato dos
        // números no momento da confirmação (valor_face, deságio, custos
        // da cedente, valor líquido, lucro bruto/líquido previsto), além
        // dos dados do próprio pagamento. Depois de gravado, a operação
        // vira Ativa e o cálculo financeiro trava (ver PUT
        // /operacoes-antecipacao/:id e as rotas de notas fiscais).

        db.run(
            `
            CREATE TABLE IF NOT EXISTS repasses (

                id INTEGER PRIMARY KEY AUTOINCREMENT,

                tenant_id INTEGER NOT NULL DEFAULT 1,

                operacao_id INTEGER NOT NULL UNIQUE,

                valor_face REAL NOT NULL,

                desagio REAL NOT NULL,

                custos_cedente REAL NOT NULL,

                valor_liquido REAL NOT NULL,

                lucro_bruto REAL NOT NULL,

                lucro_liquido_previsto REAL NOT NULL,

                data_pagamento TEXT NOT NULL,

                hora_pagamento TEXT NOT NULL,

                usuario TEXT,

                banco TEXT,

                forma_pagamento TEXT NOT NULL,

                numero_comprovante TEXT,

                observacoes TEXT,

                criado_em TEXT,

                FOREIGN KEY (operacao_id)
                    REFERENCES operacoes_antecipacao(id)

            )
            `,
            err => {
                if (err) {
                    console.error(
                        "Erro ao criar tabela repasses:",
                        err.message
                    );
                    return;
                }

                console.log("Tabela repasses pronta!");

                db.run(
                    "CREATE INDEX IF NOT EXISTS idx_repasses_operacao ON repasses(operacao_id)",
                    erroIndice => {
                        if (erroIndice) {
                            console.error(
                                "Erro ao criar índice idx_repasses_operacao:",
                                erroIndice.message
                            );
                        }
                    }
                );

                db.run(
                    "CREATE INDEX IF NOT EXISTS idx_repasses_tenant ON repasses(tenant_id)",
                    erroIndice => {
                        if (erroIndice) {
                            console.error(
                                "Erro ao criar índice idx_repasses_tenant:",
                                erroIndice.message
                            );
                        }
                    }
                );
            }
        );

        // ==========================
        // TABELA MOVIMENTAÇÕES DA OPERAÇÃO
        // ==========================
        // Mesmo papel de `movimentacoes` em Empréstimos, um por módulo —
        // ver docs/modulo-antecipacao-nf-arquitetura.md (§9) sobre a
        // unificação futura num livro-razão comum entre módulos.
        // Diferente de `movimentacoes.usuario` (existe mas nunca é
        // preenchido em Empréstimos), aqui o campo é alimentado de
        // verdade em cada evento, reaproveitando o "usuario" já coletado
        // em recebimentos/comissões/custos/repasses.

        db.run(
            `
            CREATE TABLE IF NOT EXISTS movimentacoes_nf (

                id INTEGER PRIMARY KEY AUTOINCREMENT,

                tenant_id INTEGER NOT NULL DEFAULT 1,

                operacao_id INTEGER NOT NULL,

                data TEXT NOT NULL,

                hora TEXT NOT NULL,

                tipo TEXT NOT NULL,

                descricao TEXT,

                valor REAL,

                usuario TEXT,

                criado_em TEXT,

                FOREIGN KEY (operacao_id)
                    REFERENCES operacoes_antecipacao(id)

            )
            `,
            err => {
                if (err) {
                    console.error(
                        "Erro ao criar tabela movimentacoes_nf:",
                        err.message
                    );
                    return;
                }

                console.log("Tabela movimentacoes_nf pronta!");

                db.run(
                    "CREATE INDEX IF NOT EXISTS idx_movimentacoes_nf_operacao ON movimentacoes_nf(operacao_id)",
                    erroIndice => {
                        if (erroIndice) {
                            console.error(
                                "Erro ao criar índice idx_movimentacoes_nf_operacao:",
                                erroIndice.message
                            );
                        }
                    }
                );

                db.run(
                    "CREATE INDEX IF NOT EXISTS idx_movimentacoes_nf_data ON movimentacoes_nf(data)",
                    erroIndice => {
                        if (erroIndice) {
                            console.error(
                                "Erro ao criar índice idx_movimentacoes_nf_data:",
                                erroIndice.message
                            );
                        }
                    }
                );

                db.run(
                    "CREATE INDEX IF NOT EXISTS idx_movimentacoes_nf_tenant ON movimentacoes_nf(tenant_id)",
                    erroIndice => {
                        if (erroIndice) {
                            console.error(
                                "Erro ao criar índice idx_movimentacoes_nf_tenant:",
                                erroIndice.message
                            );
                        }
                    }
                );
            }
        );

        // ==========================
        // ÍNDICES (Extrato Mensal e agregações em geral)
        // ==========================

        db.run("CREATE INDEX IF NOT EXISTS idx_emprestimos_dataEmprestimo ON emprestimos(dataEmprestimo)");
        db.run("CREATE INDEX IF NOT EXISTS idx_emprestimos_origem ON emprestimos(emprestimo_origem_id)");
        db.run("CREATE INDEX IF NOT EXISTS idx_pagamentos_emprestimo_id ON pagamentos(emprestimo_id)");
        db.run("CREATE INDEX IF NOT EXISTS idx_pagamentos_vencimento ON pagamentos(vencimento)");
        db.run("CREATE INDEX IF NOT EXISTS idx_recebimentos_pagamento_id ON recebimentos_parcelas(pagamento_id)");
        db.run("CREATE INDEX IF NOT EXISTS idx_recebimentos_data ON recebimentos_parcelas(data_recebimento)");
        db.run("CREATE INDEX IF NOT EXISTS idx_movimentacoes_emprestimo_id ON movimentacoes(emprestimo_id)");
        db.run("CREATE INDEX IF NOT EXISTS idx_movimentacoes_data ON movimentacoes(data)");

    }   // fecha o else

});     // fecha new sqlite3.Database()

function adicionarExtrato(
    emprestimoId,
    tipo,
    descricao,
    valor = 0,
    saldo = 0
) {
    const agora = new Date();

    const data =
        agora.getFullYear() +
        "-" +
        String(agora.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(agora.getDate()).padStart(2, "0");

    const hora =
        String(agora.getHours()).padStart(2, "0") +
        ":" +
        String(agora.getMinutes()).padStart(2, "0") +
        ":" +
        String(agora.getSeconds()).padStart(2, "0");

    db.run(
        `
        INSERT INTO extrato_contrato
        (
            emprestimo_id,
            data,
            hora,
            tipo,
            descricao,
            valor,
            saldo
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
            emprestimoId,
            data,
            hora,
            tipo,
            descricao,
            Number(valor) || 0,
            Number(saldo) || 0
        ],
        function (err) {
            if (err) {
                console.error(
                    "Erro ao registrar extrato:",
                    err.message
                );
                return;
            }

            console.log(
                `Extrato registrado: ${tipo} - ${data} ${hora}`
            );
        }
    );
}


db.adicionarExtrato = adicionarExtrato;

module.exports = db;