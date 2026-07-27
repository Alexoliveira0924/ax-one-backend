const express = require("express");
const cors = require("cors");
const { promisify } = require("util");
const db = require("./database");

const dbAll = promisify(db.all).bind(db);
const dbGet = promisify(db.get).bind(db);

// util.promisify não serve para db.run: o sqlite3 devolve lastID/changes
// em `this` dentro do callback, não como argumento — por isso um wrapper
// próprio em vez de promisify(db.run).
function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (erro) {
            if (erro) return reject(erro);
            resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function apenasDigitos(valor) {
    return String(valor || "").replace(/\D/g, "");
}

// ====================================
// REGISTRAR MOVIMENTAÇÃO DA OPERAÇÃO (Antecipação de NF) — Etapa 10
// ====================================
// Mesma convenção de data/hora de registrarMovimentacao (Empréstimos).
function registrarMovimentacaoNF(
    operacaoId,
    tipo,
    descricao,
    valor = null,
    usuario = null
) {

    const agora = new Date();

    const data =
        agora.toISOString().split("T")[0];

    const hora =
        agora.toLocaleTimeString("pt-BR");

    db.run(
        `
        INSERT INTO movimentacoes_nf
        (
            operacao_id,
            data,
            hora,
            tipo,
            descricao,
            valor,
            usuario,
            criado_em
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
            operacaoId,
            data,
            hora,
            tipo,
            descricao,
            valor,
            usuario,
            obterDataHoraCriacaoBrasilia()
        ],
        erro => {
            if (erro) {
                console.error(
                    "Erro ao registrar movimentação da operação:",
                    erro.message
                );
            }
        }
    );

}

const app = express();

app.use(cors());
app.use(express.json());

// ====================================
// ATUALIZAÇÃO DA ESTRUTURA DO BANCO
// ====================================

db.run(
    `ALTER TABLE emprestimos
     ADD COLUMN saldo_devedor REAL`,
    err => {
        if (err && !err.message.includes("duplicate column name")) {
            console.error(
                "Erro ao criar coluna saldo_devedor:",
                err.message
            );
        }
    }
);

db.run(
    `UPDATE emprestimos
     SET saldo_devedor = valor
     WHERE saldo_devedor IS NULL`
);

// ====================================
// DATA/HORA REAL DE CRIAÇÃO DO CONTRATO
// (horário de Brasília, gerado pelo servidor — nunca aceito do
// cliente e nunca reescrito após a criação do registro)
// ====================================

function obterDataHoraCriacaoBrasilia() {

    const partes = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    })
        .formatToParts(new Date())
        .reduce((acc, parte) => {
            acc[parte.type] = parte.value;
            return acc;
        }, {});

    return `${partes.year}-${partes.month}-${partes.day}T${partes.hour}:${partes.minute}:${partes.second}`;

}

// ====================================
// REGISTRAR MOVIMENTAÇÃO
// ====================================

function registrarMovimentacao(
    emprestimoId,
    tipo,
    descricao,
    valor = null
) {

    const agora = new Date();

    const data =
        agora.toISOString().split("T")[0];

    const hora =
        agora.toLocaleTimeString("pt-BR");

    db.run(
        `
        INSERT INTO movimentacoes
        (
            emprestimo_id,
            data,
            hora,
            tipo,
            descricao,
            valor
        )
        VALUES (?,?,?,?,?,?)
        `,
        [
            emprestimoId,
            data,
            hora,
            tipo,
            descricao,
            valor
        ]
    );

}

// Teste do servidor
app.get("/", (req, res) => {
    res.send("Servidor AX SYSTEM funcionando!");
});

// Listar clientes
app.get("/clientes", (req, res) => {

    db.all("SELECT * FROM clientes", [], (err, rows) => {

        if (err) {
            return res.status(500).json(err);
        }

        res.json(rows);

    });

});

// Cadastrar cliente
app.post("/clientes", (req, res) => {

    const {
        codigo,
        nome,
        cpf,
        telefone,
        email,
        cidade,
        observacao,
        status
    } = req.body;

    db.run(
        `INSERT INTO clientes
        (codigo, nome, cpf, telefone, email, cidade, observacao, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            codigo,
            nome,
            cpf,
            telefone,
            email,
            cidade,
            observacao,
            status
        ],
        function (err) {

            if (err) {
                return res.status(500).json(err);
            }

            res.json({
                id: this.lastID,
                mensagem: "Cliente cadastrado com sucesso!"
            });

        }
    );

});

// =======================
// Atualizar cliente
// =======================

app.put("/clientes/:id", (req, res) => {

    const {
        codigo,
        nome,
        cpf,
        telefone,
        email,
        cidade,
        observacao,
        status
    } = req.body;

    db.run(
        `UPDATE clientes
        SET
            codigo = ?,
            nome = ?,
            cpf = ?,
            telefone = ?,
            email = ?,
            cidade = ?,
            observacao = ?,
            status = ?
        WHERE id = ?`,
        [
            codigo,
            nome,
            cpf,
            telefone,
            email,
            cidade,
            observacao,
            status,
            req.params.id
        ],
        function (err) {

            if (err) {
                return res.status(500).json(err);
            }

            res.json({
                mensagem: "Cliente atualizado com sucesso!"
            });

        }
    );

});

// Excluir cliente
app.delete("/clientes/:id", (req, res) => {

    db.run(
        "DELETE FROM clientes WHERE id = ?",
        [req.params.id],
        function (err) {

            if (err) {
                return res.status(500).json(err);
            }

            res.json({
                mensagem: "Cliente excluído com sucesso!"
            });

        }
    );

});

// =======================
// LISTAR EMPRÉSTIMOS
// =======================

app.get("/emprestimos/historico/:contrato", (req, res) => {

    const contrato = req.params.contrato;

    db.all(

        `
        SELECT *
        FROM emprestimos
        WHERE contrato = ?
           OR contrato_origem = ?
        ORDER BY id
        `,

        [contrato, contrato],

        (erro, linhas) => {

            if (erro) {

                return res.status(500).json({
                    mensagem: erro.message
                });

            }

            res.json(linhas);

        }

    );

});

// ================================
// HISTÓRICO DO EMPRÉSTIMO
// ================================
app.get("/historico-emprestimo/:id", (req, res) => {
    const { id } = req.params;

    const historico = [];

    function buscarHistorico(idContrato) {
        db.get(
            `
            SELECT
                e.*,

                COALESCE(
                    (
                        SELECT SUM(p.valor)
                        FROM pagamentos p
                        WHERE p.emprestimo_id = e.id
                        AND p.status = 'Pendente'
                    ),
                    0
                ) AS valor_a_receber,

                COALESCE(
                    (
                        SELECT COUNT(*)
                        FROM pagamentos p
                        WHERE p.emprestimo_id = e.id
                        AND p.status = 'Pendente'
                    ),
                    0
                ) AS parcelas_pendentes,

                COALESCE(
                    (
                        SELECT COUNT(*)
                        FROM pagamentos p
                        WHERE p.emprestimo_id = e.id
                        AND p.status IN ('Pago', 'Recebido')
                    ),
                    0
                ) AS parcelas_pagas

            FROM emprestimos e
            WHERE e.id = ?
            `,
            [idContrato],
            (err, contrato) => {
                if (err) {
                    console.error(
                        "Erro ao buscar histórico:",
                        err.message
                    );

                    return res.status(500).json({
                        erro: "Erro ao buscar histórico do contrato."
                    });
                }

                if (!contrato) {
                    return res.json(historico);
                }

                historico.push(contrato);

                if (contrato.emprestimo_origem_id) {
                    buscarHistorico(
                        contrato.emprestimo_origem_id
                    );
                } else {
                    res.json(historico);
                }
            }
        );
    }

    buscarHistorico(id);
});

// ===================================
// LINHA DO TEMPO DO CONTRATO
// ===================================

// Percorre toda a cadeia de contratos vinculados a partir de um id,
// andando nos dois sentidos (emprestimo_origem_id para trás, até o
// contrato original; emprestimo_filho_id para frente, até o mais
// recente). Cada contrato tem no máximo uma origem e um filho, então é
// uma lista — o Set + fila evita repetir id e serve de trava contra
// ciclo, mas na prática a cadeia sempre termina.
function resolverCadeiaContratos(idInicial, callback) {

    const idsNaCadeia = new Set();
    const filaParaVisitar = [Number(idInicial)];

    function visitarProximo() {

        if (filaParaVisitar.length === 0) {
            return callback(null, Array.from(idsNaCadeia));
        }

        const idAtual = filaParaVisitar.shift();

        if (!idAtual || idsNaCadeia.has(idAtual)) {
            return visitarProximo();
        }

        idsNaCadeia.add(idAtual);

        db.get(
            `SELECT id, emprestimo_origem_id, emprestimo_filho_id
             FROM emprestimos WHERE id = ?`,
            [idAtual],
            (erro, linha) => {

                if (erro) {
                    return callback(erro);
                }

                if (linha) {
                    if (linha.emprestimo_origem_id && !idsNaCadeia.has(linha.emprestimo_origem_id)) {
                        filaParaVisitar.push(linha.emprestimo_origem_id);
                    }

                    if (linha.emprestimo_filho_id && !idsNaCadeia.has(linha.emprestimo_filho_id)) {
                        filaParaVisitar.push(linha.emprestimo_filho_id);
                    }
                }

                visitarProximo();
            }
        );
    }

    visitarProximo();
}

app.get("/linha-tempo-contrato/:id", (req, res) => {
    const { id } = req.params;

    resolverCadeiaContratos(id, (erroCadeia, idsCadeia) => {

        if (erroCadeia) {
            console.error(
                "Erro ao resolver a cadeia de contratos:",
                erroCadeia
            );

            return res.status(500).json({
                erro: "Erro ao localizar a cadeia de contratos."
            });
        }

        if (idsCadeia.length === 0) {
            return res.json([]);
        }

        const placeholdersMovimentacoes = idsCadeia.map(() => "?").join(",");
        const placeholdersExtrato = idsCadeia.map(() => "?").join(",");

        db.all(
            `
            SELECT
                m.id AS id_evento,
                m.emprestimo_id,
                e.contrato AS contrato,
                m.data,
                m.hora,
                m.tipo,
                m.descricao,
                m.valor,
                NULL AS saldo,
                'movimentacoes' AS origem
            FROM movimentacoes m
            JOIN emprestimos e ON e.id = m.emprestimo_id
            WHERE m.emprestimo_id IN (${placeholdersMovimentacoes})

            UNION ALL

            SELECT
                x.id AS id_evento,
                x.emprestimo_id,
                e.contrato AS contrato,
                x.data,
                x.hora,
                x.tipo,
                x.descricao,
                x.valor,
                x.saldo,
                'extrato_contrato' AS origem
            FROM extrato_contrato x
            JOIN emprestimos e ON e.id = x.emprestimo_id
            WHERE x.emprestimo_id IN (${placeholdersExtrato})

            ORDER BY
                data ASC,
                hora ASC,
                id_evento ASC
            `,
            [...idsCadeia, ...idsCadeia],
            (erro, registros) => {
                if (erro) {
                    console.error(
                        "Erro ao buscar linha do tempo:",
                        erro.message
                    );

                    return res.status(500).json({
                        erro: "Erro ao buscar a linha do tempo do contrato."
                    });
                }

                // "id_evento" existe só para o ORDER BY não colidir com
                // emprestimos.id (trazido pelo JOIN) — a API continua
                // devolvendo "id", como sempre devolveu.
                const eventos = (registros || []).map((registro) => {
                    const { id_evento, ...resto } = registro;
                    return { id: id_evento, ...resto };
                });

                res.json(eventos);
            }
        );
    });
});

// =======================
// LISTAR EMPRÉSTIMOS
// =======================

app.get("/emprestimos", (req, res) => {

    db.all(
        `
SELECT
    e.*,
    origem.contrato AS contrato_origem,
    origem.status AS status_origem,

    MAX(
        0,

        COALESCE(
            (
                SELECT SUM(p.valor)
                FROM pagamentos p
                WHERE p.emprestimo_id = e.id
                AND p.status = 'Pendente'
            ),
            0
        )

        -

        COALESCE(
            (
                SELECT SUM(m.valor)
                FROM movimentacoes m
                WHERE m.emprestimo_id = e.id
                AND m.tipo = 'Amortização'
            ),
            0
        )
    ) AS valor_a_receber

FROM emprestimos e

LEFT JOIN emprestimos origem
    ON origem.id = e.emprestimo_origem_id

ORDER BY e.id DESC
`,
        [],
        (err, rows) => {

            if (err) {
                return res.status(500).json(err);
            }

            res.json(rows);

        }
    );

});

// =======================
// PRÓXIMO CONTRATO
// =======================

app.get("/proximo-contrato", (req, res) => {

    db.get(
        `SELECT contrato
         FROM emprestimos
         ORDER BY id DESC
         LIMIT 1`,
        [],
        (err, row) => {

            if (err) {
                return res.status(500).json(err);
            }

            let numero = 1;

            if (row && row.contrato) {

                numero =
                    parseInt(row.contrato.split("-")[2]) + 1;

            }

            const contrato =
                `AX-2026-${numero.toString().padStart(6, "0")}`;

            res.json({
                contrato
            });

        }   // fecha o callback (err, row) => {

    );      // fecha o db.get

});         // fecha o app.get

// =======================
// CADASTRAR EMPRÉSTIMO
// =======================

app.post("/emprestimos", (req, res) => {

    const {
        contrato,
        cliente,
        valor,
        juros,
        parcelas,
        dataEmprestimo,
        primeiroVencimento,
        observacoes,
        tipoEmprestimo
    } = req.body;

    const tipoEmprestimoFinal =
        tipoEmprestimo === "juros_mensal"
            ? "juros_mensal"
            : "parcelas_fixas";

console.log("PASSOU DO SELECT");
    db.run(
        `INSERT INTO emprestimos
        (
            contrato,
            cliente,
            valor,
            juros,
            parcelas,
            dataEmprestimo,
            primeiroVencimento,
            observacoes,
            status,
            tipo_emprestimo,
            criadoEm
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            contrato,
            cliente,
            valor,
            juros,
            parcelas,
            dataEmprestimo,
            primeiroVencimento,
            observacoes,
            "Ativo",
            tipoEmprestimoFinal,
            obterDataHoraCriacaoBrasilia()
        ],
        function(err){

            if (err) {
    console.log("ERRO SQLITE:", err);
    return res.status(500).json({
        mensagem: err.message
    });
}

            const emprestimoId = this.lastID;

            registrarMovimentacao(
    emprestimoId,
    "Criação",
    `Contrato ${contrato} criado com ${parcelas} parcelas e juros de ${juros}%`,
    valor
);

            const primeiraData = new Date(primeiroVencimento);

            const valorTotal = Number(valor) + (Number(valor) * (Number(juros) / 100) * Number(parcelas));

            const valorParcela = valorTotal / Number(parcelas);

            const jurosMensalContrato =
                Number(valor) * (Number(juros) / 100);

            for(let i=1;i<=parcelas;i++){
                console.log("Gerando parcela", i);

                const vencimento = new Date(primeiraData);
                vencimento.setMonth(vencimento.getMonth() + (i-1));

                const dataFormatada =
                    vencimento.getFullYear() + "-" +
                    String(vencimento.getMonth()+1).padStart(2,"0") + "-" +
                    String(vencimento.getDate()).padStart(2,"0");

                    // Parcelas Fixas (Principal + Juros): lógica original, inalterada.
                    // Pagamento Mensal de Juros: só juros até a penúltima parcela;
                    // a última cobra o principal integral + o último juros.
                    const valorParcelaCalculada =
                        tipoEmprestimoFinal === "juros_mensal"
                            ? (i < parcelas
                                ? jurosMensalContrato
                                : Number(valor) + jurosMensalContrato)
                            : valorParcela;

                    console.log("Emprestimo ID:", emprestimoId);
                    console.log("Parcela:", i);
                    console.log("Valor:", valorParcelaCalculada);
                    console.log("Data:", dataFormatada);

                db.run(
    `INSERT INTO pagamentos
    (
        emprestimo_id,
        parcela,
        vencimento,
        valor,
        status
    )
    VALUES (?,?,?,?,?)`,
    [
        emprestimoId,
        i,
        dataFormatada,
        valorParcelaCalculada,
        "Pendente"
    ],
    function(err){

        if(err){
    console.log("ERRO AO INSERIR PARCELA:");
    console.log(err);
}else{
    console.log("Parcela", i, "gravada com sucesso!");
}

    }
);
}

            res.json({
    id: emprestimoId,
    mensagem: "Empréstimo cadastrado com sucesso!"
});

        }

    );

});

// ============================
// LISTAR PAGAMENTOS DO EMPRÉSTIMO
// SEPARANDO PARCELA E JUROS
// ============================

app.get("/pagamentos/:emprestimoId", (req, res) => {
    const { emprestimoId } = req.params;

    db.all(
        `
        SELECT
            p.*,

            COALESCE(
                SUM(
                    CASE
                        WHEN r.tipo = 'Parcela'
                        THEN r.valor_recebido
                        ELSE 0
                    END
                ),
                0
            ) AS valor_recebido,

            COALESCE(
                SUM(
                    CASE
                        WHEN r.tipo = 'Juros'
                        THEN r.valor_recebido
                        ELSE 0
                    END
                ),
                0
            ) AS juros_recebidos,

            COALESCE(
                SUM(
                    CASE
                        WHEN r.tipo = 'Parcela'
                        THEN r.valor_recebido
                        ELSE 0
                    END
                ),
                0
            ) AS valor_aplicado,

            -- Desconto concedido (ex.: antecipação de parcela) também
            -- quita a parcela, mesmo sem entrada de caixa equivalente —
            -- por isso soma junto com valor_recebido para decidir
            -- saldo/status, mas fica exposto separadamente também.
            COALESCE(
                SUM(
                    CASE
                        WHEN r.tipo = 'Parcela'
                        THEN r.desconto
                        ELSE 0
                    END
                ),
                0
            ) AS desconto_total,

            CASE
                WHEN
                    COALESCE(
                        SUM(
                            CASE
                                WHEN r.tipo = 'Parcela'
                                THEN r.valor_recebido + r.desconto
                                ELSE 0
                            END
                        ),
                        0
                    ) >= p.valor - 0.009
                THEN 0

                ELSE
                    p.valor -
                    COALESCE(
                        SUM(
                            CASE
                                WHEN r.tipo = 'Parcela'
                                THEN r.valor_recebido + r.desconto
                                ELSE 0
                            END
                        ),
                        0
                    )
            END AS saldo_restante,

            CASE
                WHEN
                    COALESCE(
                        SUM(
                            CASE
                                WHEN r.tipo = 'Parcela'
                                THEN r.valor_recebido + r.desconto
                                ELSE 0
                            END
                        ),
                        0
                    ) >= p.valor - 0.009
                THEN 'Pago'

                WHEN
                    COALESCE(
                        SUM(
                            CASE
                                WHEN r.tipo = 'Parcela'
                                THEN r.valor_recebido + r.desconto
                                ELSE 0
                            END
                        ),
                        0
                    ) > 0
                THEN 'Parcial'

                ELSE 'Pendente'
            END AS status_calculado

        FROM pagamentos p

        LEFT JOIN recebimentos_parcelas r
            ON r.pagamento_id = p.id

        WHERE p.emprestimo_id = ?

        GROUP BY p.id

        ORDER BY p.parcela
        `,
        [emprestimoId],
        (err, rows) => {
            if (err) {
                console.error(
                    "Erro ao listar pagamentos:",
                    err
                );

                return res.status(500).json({
                    erro: "Erro ao listar as parcelas."
                });
            }

            const pagamentosFormatados = rows.map(
                (pagamento) => ({
                    ...pagamento,

                    valor: Number(
                        pagamento.valor || 0
                    ),

                    valor_recebido: Number(
                        pagamento.valor_recebido || 0
                    ),

                    juros_recebidos: Number(
                        pagamento.juros_recebidos || 0
                    ),

                    valor_aplicado: Number(
                        pagamento.valor_aplicado || 0
                    ),

                    desconto_total: Number(
                        pagamento.desconto_total || 0
                    ),

                    saldo_restante: Number(
                        pagamento.saldo_restante || 0
                    ),

                    status:
                        pagamento.status_calculado
                })
            );

            res.json(pagamentosFormatados);
        }
    );
});

// ==========================================
// HISTÓRICO DE RECEBIMENTOS DE UMA PARCELA
// ==========================================
app.get("/recebimentos-parcela/:pagamentoId", (req, res) => {
  const pagamentoId = Number(req.params.pagamentoId);

  if (!pagamentoId || pagamentoId <= 0) {
    return res.status(400).json({
      erro: "Parcela inválida.",
    });
  }

  db.get(
    `
      SELECT
        id,
        parcela,
        valor,
        vencimento,
        status
      FROM pagamentos
      WHERE id = ?
    `,
    [pagamentoId],
    (erroParcela, parcela) => {
      if (erroParcela) {
        console.error(
          "Erro ao consultar parcela:",
          erroParcela
        );

        return res.status(500).json({
          erro: "Erro ao consultar a parcela.",
        });
      }

      if (!parcela) {
        return res.status(404).json({
          erro: "Parcela não encontrada.",
        });
      }

      db.all(
        `
          SELECT
            id,
            pagamento_id,
            data_recebimento,
            valor_recebido,
            juros,
            multa,
            desconto,
            observacoes,
            criado_em,
            COALESCE(tipo, 'Parcela') AS tipo
          FROM recebimentos_parcelas
          WHERE pagamento_id = ?
          ORDER BY
            data_recebimento ASC,
            id ASC
        `,
        [pagamentoId],
        (erroRecebimentos, recebimentos) => {
          if (erroRecebimentos) {
            console.error(
              "Erro ao consultar histórico de recebimentos:",
              erroRecebimentos
            );

            return res.status(500).json({
              erro:
                "Erro ao consultar o histórico da parcela.",
            });
          }

          /*
            Cada recebimento é ou uma parcela (tipo 'Parcela',
            amortiza o saldo) ou um recebimento avulso de juros
            (tipo 'Juros', não amortiza — ver PUT /pagamentos/:id).
            valor_recebido_parcela/principal_amortizado e
            juros_avulsos_recebidos são mutuamente exclusivos por
            linha, nunca somados ao mesmo saldo.
          */
          const historico = recebimentos.map(
            (recebimento) => {
              const valorRecebido = Number(
                recebimento.valor_recebido || 0
              );

              const desconto = Number(
                recebimento.desconto || 0
              );

              const ehParcela =
                recebimento.tipo === "Parcela";

              return {
                ...recebimento,

                valor_recebido: valorRecebido,

                juros: Number(
                  recebimento.juros || 0
                ),

                multa: Number(
                  recebimento.multa || 0
                ),

                desconto,

                valorRecebidoParcela: ehParcela
                  ? valorRecebido
                  : 0,

                jurosAvulsosRecebidos: ehParcela
                  ? 0
                  : valorRecebido,

                principalAmortizado: ehParcela
                  ? valorRecebido + desconto
                  : 0,
              };
            }
          );

          const totalRecebido = historico.reduce(
            (soma, recebimento) =>
              soma + recebimento.valor_recebido,
            0
          );

          const totalMulta = historico.reduce(
            (soma, recebimento) =>
              soma + recebimento.multa,
            0
          );

          const totalDesconto = historico.reduce(
            (soma, recebimento) =>
              soma + recebimento.desconto,
            0
          );

          const totalRecebidoParcela = historico.reduce(
            (soma, recebimento) =>
              soma + recebimento.valorRecebidoParcela,
            0
          );

          const totalJurosAvulsosRecebidos = historico.reduce(
            (soma, recebimento) =>
              soma + recebimento.jurosAvulsosRecebidos,
            0
          );

          const totalPrincipalAmortizado = historico.reduce(
            (soma, recebimento) =>
              soma + recebimento.principalAmortizado,
            0
          );

          // Somente recebimentos tipo 'Parcela' reduzem o saldo.
          const totalAplicado = totalPrincipalAmortizado;

          const valorOriginal = Number(
            parcela.valor || 0
          );

          const saldoRestante = Math.max(
            valorOriginal - totalAplicado,
            0
          );

          return res.json({
            parcela: {
              id: parcela.id,
              numero: parcela.parcela,
              valorOriginal,
              vencimento: parcela.vencimento,
              status:
                saldoRestante <= 0.009
                  ? "Pago"
                  : totalAplicado > 0
                  ? "Parcial"
                  : "Pendente",
            },

            resumo: {
              quantidadeRecebimentos:
                historico.length,

              totalRecebido,
              totalAplicado,
              totalMulta,
              totalDesconto,
              saldoRestante,

              valorRecebidoParcela: totalRecebidoParcela,
              jurosAvulsosRecebidos: totalJurosAvulsosRecebidos,
              principalAmortizado: totalPrincipalAmortizado,
            },

            recebimentos: historico,
          });
        }
      );
    }
  );
});

// =======================
// ATUALIZAR EMPRÉSTIMO
// =======================

app.put("/emprestimos/:id", (req, res) => {

    const emprestimoId = req.params.id;

    const {
        cliente,
        valor,
        juros,
        parcelas,
        dataEmprestimo,
        primeiroVencimento,
        observacoes,
        tipoEmprestimo,
        confirmarAlteracaoFinanceira
    } = req.body;

    const tipoEmprestimoFinal =
        tipoEmprestimo === "juros_mensal"
            ? "juros_mensal"
            : "parcelas_fixas";

    db.get(
        `SELECT * FROM emprestimos WHERE id = ?`,
        [emprestimoId],
        (erroBusca, emprestimoAtual) => {

            if (erroBusca) {
                console.error("Erro ao buscar contrato para edição:", erroBusca);
                return res.status(500).json({
                    erro: "Erro ao localizar o contrato."
                });
            }

            if (!emprestimoAtual) {
                return res.status(404).json({
                    erro: "Contrato não encontrado."
                });
            }

            // O número do contrato nunca é alterável por aqui — trava no
            // servidor, não depende só do frontend não enviar o campo.
            const contratoImutavel = emprestimoAtual.contrato;

            // Campos "financeiros": exigem recálculo das parcelas pendentes
            // e, por isso, ficam sujeitos às regras de status abaixo.
            // cliente/observações nunca entram aqui — são "correções
            // cadastrais seguras", sempre permitidas.
            const camposFinanceirosAlterados =
                Number(valor) !== Number(emprestimoAtual.valor) ||
                Number(juros) !== Number(emprestimoAtual.juros) ||
                Number(parcelas) !== Number(emprestimoAtual.parcelas) ||
                dataEmprestimo !== emprestimoAtual.dataEmprestimo ||
                primeiroVencimento !== emprestimoAtual.primeiroVencimento ||
                tipoEmprestimoFinal !== emprestimoAtual.tipo_emprestimo;

            // Só cliente/observações mudaram (ou nada mudou) — sempre
            // permitido, em qualquer status, sem tocar nas parcelas.
            if (!camposFinanceirosAlterados) {
                return db.run(
                    `UPDATE emprestimos
                     SET cliente = ?, observacoes = ?
                     WHERE id = ?`,
                    [cliente, observacoes, emprestimoId],
                    function (erroUpdateSimples) {

                        if (erroUpdateSimples) {
                            console.error(
                                "Erro ao atualizar dados cadastrais do contrato:",
                                erroUpdateSimples
                            );
                            return res.status(500).json({
                                erro: "Erro ao atualizar o contrato."
                            });
                        }

                        res.json({
                            mensagem: "Empréstimo atualizado com sucesso!"
                        });

                    }
                );
            }

            const statusBloqueiaFinanceiro =
                emprestimoAtual.status === "Quitado" ||
                emprestimoAtual.status === "Renegociado" ||
                emprestimoAtual.status === "Renovado";

            if (statusBloqueiaFinanceiro) {
                return res.status(400).json({
                    erro:
                        "Contratos quitados ou renegociados não podem ter valores alterados, pois fazem parte do histórico financeiro."
                });
            }

            if (
                !Number.isFinite(Number(valor)) || Number(valor) < 0 ||
                !Number.isFinite(Number(juros)) || Number(juros) < 0 ||
                !Number.isInteger(Number(parcelas)) || Number(parcelas) <= 0
            ) {
                return res.status(400).json({
                    erro: "Informe valor, juros e quantidade de parcelas válidos."
                });
            }

            // Contrato Ativo com alteração financeira: verifica se já existe
            // algum recebimento (total ou parcial) em qualquer parcela.
            db.all(
                `
                SELECT
                    p.id,
                    p.parcela,
                    COALESCE(SUM(r.valor_recebido), 0) AS totalRecebido
                FROM pagamentos p
                LEFT JOIN recebimentos_parcelas r
                    ON r.pagamento_id = p.id
                WHERE p.emprestimo_id = ?
                GROUP BY p.id
                ORDER BY p.parcela
                `,
                [emprestimoId],
                (erroPagamentos, linhasPagamento) => {

                    if (erroPagamentos) {
                        console.error(
                            "Erro ao verificar parcelas do contrato:",
                            erroPagamentos
                        );
                        return res.status(500).json({
                            erro: "Erro ao verificar as parcelas do contrato."
                        });
                    }

                    const parcelasComRecebimento = linhasPagamento.filter(
                        (linha) => Number(linha.totalRecebido) > 0
                    );

                    const possuiPagamentos = parcelasComRecebimento.length > 0;

                    // Regra 2: contrato Ativo já com pagamento(s) exige
                    // confirmação explícita antes de recalcular.
                    if (possuiPagamentos && !confirmarAlteracaoFinanceira) {
                        return res.status(409).json({
                            confirmacaoNecessaria: true,
                            erro:
                                "Este contrato já possui pagamentos registrados. Alterações financeiras podem modificar o saldo e as parcelas pendentes. Os pagamentos já realizados serão preservados. Deseja continuar?"
                        });
                    }

                    const idsParcelasPendentes = linhasPagamento
                        .filter((linha) => Number(linha.totalRecebido) <= 0)
                        .map((linha) => linha.id);

                    const quantidadeParcelasProtegidas =
                        linhasPagamento.length - idsParcelasPendentes.length;

                    if (Number(parcelas) < quantidadeParcelasProtegidas) {
                        return res.status(400).json({
                            erro:
                                `Este contrato já tem ${quantidadeParcelasProtegidas} parcela(s) com recebimento registrado — a nova quantidade de parcelas não pode ser menor que isso.`
                        });
                    }

                    db.serialize(() => {

                        db.run("BEGIN TRANSACTION");

                        db.run(
                            `UPDATE emprestimos
                             SET cliente = ?, valor = ?, juros = ?, parcelas = ?,
                                 dataEmprestimo = ?, primeiroVencimento = ?,
                                 observacoes = ?, tipo_emprestimo = ?
                             WHERE id = ?`,
                            [
                                cliente,
                                valor,
                                juros,
                                parcelas,
                                dataEmprestimo,
                                primeiroVencimento,
                                observacoes,
                                tipoEmprestimoFinal,
                                emprestimoId
                            ],
                            function (erroUpdateEmprestimo) {

                                if (erroUpdateEmprestimo) {
                                    db.run("ROLLBACK");
                                    console.error(
                                        "Erro ao atualizar contrato (edição financeira):",
                                        erroUpdateEmprestimo
                                    );
                                    return res.status(500).json({
                                        erro: "Erro ao atualizar os dados do contrato."
                                    });
                                }

                                function recriarParcelasPendentes() {

                                    const totalParcelasNovas =
                                        Number(parcelas) - quantidadeParcelasProtegidas;

                                    if (totalParcelasNovas <= 0) {
                                        return concluirEdicao(0);
                                    }

                                    const primeiraData = new Date(primeiroVencimento);

                                    const valorTotal =
                                        Number(valor) +
                                        (Number(valor) * (Number(juros) / 100) * Number(parcelas));

                                    const valorParcelaFixa = valorTotal / Number(parcelas);

                                    const jurosMensalContrato =
                                        Number(valor) * (Number(juros) / 100);

                                    let inseridas = 0;
                                    let houveErroInsercao = false;

                                    for (
                                        let numeroParcela = quantidadeParcelasProtegidas + 1;
                                        numeroParcela <= Number(parcelas);
                                        numeroParcela++
                                    ) {

                                        const vencimento = new Date(primeiraData);
                                        vencimento.setMonth(
                                            vencimento.getMonth() + (numeroParcela - 1)
                                        );

                                        const dataFormatada =
                                            vencimento.getFullYear() + "-" +
                                            String(vencimento.getMonth() + 1).padStart(2, "0") + "-" +
                                            String(vencimento.getDate()).padStart(2, "0");

                                        const valorParcelaCalculada =
                                            tipoEmprestimoFinal === "juros_mensal"
                                                ? (numeroParcela < Number(parcelas)
                                                    ? jurosMensalContrato
                                                    : Number(valor) + jurosMensalContrato)
                                                : valorParcelaFixa;

                                        db.run(
                                            `INSERT INTO pagamentos
                                             (emprestimo_id, parcela, vencimento, valor, status)
                                             VALUES (?, ?, ?, ?, ?)`,
                                            [
                                                emprestimoId,
                                                numeroParcela,
                                                dataFormatada,
                                                valorParcelaCalculada,
                                                "Pendente"
                                            ],
                                            (erroInsert) => {

                                                inseridas++;

                                                if (erroInsert) {
                                                    houveErroInsercao = true;
                                                    console.error(
                                                        "Erro ao recriar parcela pendente:",
                                                        erroInsert
                                                    );
                                                }

                                                if (inseridas === totalParcelasNovas) {

                                                    if (houveErroInsercao) {
                                                        db.run("ROLLBACK");
                                                        return res.status(500).json({
                                                            erro: "Erro ao recriar as parcelas pendentes."
                                                        });
                                                    }

                                                    concluirEdicao(totalParcelasNovas);
                                                }
                                            }
                                        );
                                    }
                                }

                                function concluirEdicao(parcelasRecriadas) {

                                    registrarMovimentacao(
                                        emprestimoId,
                                        "Edição de Contrato",
                                        `Contrato ${contratoImutavel} editado — dados financeiros recalculados ` +
                                        `(${quantidadeParcelasProtegidas} parcela(s) com recebimento preservada(s), ` +
                                        `${parcelasRecriadas} parcela(s) pendente(s) recriada(s)).`,
                                        null
                                    );

                                    db.run("COMMIT", (erroCommit) => {

                                        if (erroCommit) {
                                            db.run("ROLLBACK");
                                            console.error(
                                                "Erro ao concluir edição do contrato:",
                                                erroCommit
                                            );
                                            return res.status(500).json({
                                                erro: "Erro ao concluir a edição do contrato."
                                            });
                                        }

                                        res.json({
                                            mensagem: "Empréstimo atualizado com sucesso!",
                                            parcelas_preservadas: quantidadeParcelasProtegidas,
                                            parcelas_recriadas: parcelasRecriadas
                                        });
                                    });
                                }

                                if (idsParcelasPendentes.length === 0) {
                                    recriarParcelasPendentes();
                                } else {
                                    const placeholders = idsParcelasPendentes
                                        .map(() => "?")
                                        .join(",");

                                    db.run(
                                        `DELETE FROM pagamentos WHERE id IN (${placeholders})`,
                                        idsParcelasPendentes,
                                        (erroDelete) => {

                                            if (erroDelete) {
                                                db.run("ROLLBACK");
                                                console.error(
                                                    "Erro ao remover parcelas pendentes antigas:",
                                                    erroDelete
                                                );
                                                return res.status(500).json({
                                                    erro: "Erro ao remover as parcelas pendentes."
                                                });
                                            }

                                            recriarParcelasPendentes();
                                        }
                                    );
                                }
                            }
                        );
                    });
                }
            );
        }
    );

});

// =======================
// EXCLUIR EMPRÉSTIMO
// =======================

app.delete("/emprestimos/:id", (req, res) => {

    const id = req.params.id;

    // Primeiro exclui as parcelas do empréstimo
    db.run(
        "DELETE FROM pagamentos WHERE emprestimo_id = ?",
        [id],
        function(err){

            if(err){
                return res.status(500).json(err);
            }

            // Depois exclui o empréstimo
            db.run(
                "DELETE FROM emprestimos WHERE id = ?",
                [id],
                function(err){

                    if(err){
                        return res.status(500).json(err);
                    }

                    res.json({
                        sucesso: true,
                        mensagem: "Empréstimo excluído com sucesso!"
                    });

                }
            );

        }
    );

});


// ============================
// CADASTRAR PAGAMENTO
// ============================

app.post("/pagamentos", (req, res) => {

    const {
        emprestimo_id,
        parcela,
        vencimento,
        valor
    } = req.body;

    db.run(
        `INSERT INTO pagamentos
        (emprestimo_id, parcela, vencimento, valor)
        VALUES (?,?,?,?)`,
        [
            emprestimo_id,
            parcela,
            vencimento,
            valor
        ],
        function(err){

            if(err){
                return res.status(500).json(err);
            }

            res.json({
                sucesso: true,
                id: this.lastID
            });

        }
    );

});

// ==========================================
// RECEBER PARCELA OU SOMENTE JUROS
// ==========================================
app.put("/pagamentos/:id", (req, res) => {
  const parcelaId = Number(req.params.id);

  const {
  tipo = "Parcela",
  dataPagamento,
  valorRecebido,
  valorJuros,
  observacoes = "",
} = req.body;

const tipoRecebimento =
  tipo === "Juros" ? "Juros" : "Parcela";

const valorParcelaNumero = Number(
  valorRecebido || 0
);

const valorJurosNumero = Number(
  valorJuros || 0
);

const valorOperacao =
  tipoRecebimento === "Juros"
    ? valorJurosNumero
    : valorParcelaNumero;

  const dataPagamentoFinal =
    dataPagamento ||
    new Date().toISOString().split("T")[0];

  const toleranciaCentavos = 0.009;

  if (!parcelaId || parcelaId <= 0) {
    return res.status(400).json({
      erro: "Parcela inválida.",
    });
  }

  if (
  !Number.isFinite(valorOperacao) ||
  valorOperacao <= 0
) {
  return res.status(400).json({
    erro:
      tipoRecebimento === "Juros"
        ? "Informe o valor dos juros pago."
        : "Informe um valor recebido maior que zero.",
  });
}

  db.get(
    `
      SELECT
        id,
        emprestimo_id,
        parcela,
        valor,
        status
      FROM pagamentos
      WHERE id = ?
    `,
    [parcelaId],
    (erroParcela, parcela) => {
      if (erroParcela) {
        console.error(
          "Erro ao consultar parcela:",
          erroParcela
        );

        return res.status(500).json({
          erro: "Erro ao consultar a parcela.",
        });
      }

      if (!parcela) {
        return res.status(404).json({
          erro: "Parcela não encontrada.",
        });
      }

      db.get(
        `
          SELECT
            COALESCE(
              SUM(
                CASE
                  WHEN COALESCE(tipo, 'Parcela') = 'Parcela'
                  THEN valor_recebido + desconto
                  ELSE 0
                END
              ),
              0
            ) AS total_aplicado,

            COALESCE(
              SUM(
                CASE
                  WHEN COALESCE(tipo, 'Parcela') = 'Parcela'
                  THEN valor_recebido
                  ELSE 0
                END
              ),
              0
            ) AS total_recebido_parcela,

            COALESCE(
              SUM(
                CASE
                  WHEN tipo = 'Juros'
                  THEN valor_recebido
                  ELSE 0
                END
              ),
              0
            ) AS total_juros_recebidos

          FROM recebimentos_parcelas
          WHERE pagamento_id = ?
        `,
        [parcelaId],
        (erroTotais, totais) => {
          if (erroTotais) {
            console.error(
              "Erro ao consultar recebimentos:",
              erroTotais
            );

            return res.status(500).json({
              erro:
                "Erro ao calcular os recebimentos da parcela.",
            });
          }

          const valorOriginal = Number(
            parcela.valor || 0
          );

          const totalAplicadoAnterior = Number(
            totais.total_aplicado || 0
          );

          const saldoAntes = Math.max(
            valorOriginal - totalAplicadoAnterior,
            0
          );

          /*
            Somente juros:
            - registra receita adicional;
            - não reduz o saldo da parcela;
            - pode ser maior ou menor que o saldo.
          */
          if (tipoRecebimento === "Juros") {
            db.run(
              `
                INSERT INTO recebimentos_parcelas (
                  pagamento_id,
                  data_recebimento,
                  valor_recebido,
                  juros,
                  multa,
                  desconto,
                  observacoes,
                  tipo
                )
                VALUES (?, ?, ?, 0, 0, 0, ?, 'Juros')
              `,
              [
                parcelaId,
                dataPagamentoFinal,
                valorOperacao,
                observacoes,
              ],
              function (erroRecebimentoJuros) {
                if (erroRecebimentoJuros) {
                  console.error(
                    "Erro ao registrar juros:",
                    erroRecebimentoJuros
                  );

                  return res.status(500).json({
                    erro:
                      "Erro ao registrar o recebimento dos juros.",
                  });
                }

                registrarMovimentacao(
                  parcela.emprestimo_id,
                  "Recebimento Somente de Juros",
                  `Juros referentes à parcela ${
                    parcela.parcela
                  } — R$ ${valorOperacao.toFixed(2)}`,
                  valorOperacao
                );

                return res.json({
                  sucesso: true,
                  mensagem:
                    "Recebimento de juros registrado com sucesso.",
                  tipo: "Juros",
                  recebimentoId: this.lastID,
                  parcelaId,
                  parcela: parcela.parcela,
                  dataPagamento: dataPagamentoFinal,
                  valorRecebido:
                    valorOperacao,
                  saldoParcela: saldoAntes,
                });
              }
            );

            return;
          }

          /*
            Pagamento de parcela:
            não pode ultrapassar o saldo restante.
          */
          if (
            valorOperacao >
            saldoAntes + toleranciaCentavos
          ) {
            return res.status(400).json({
              erro:
                "O valor informado é maior que o saldo da parcela.",

              mensagem:
                `O saldo atual da parcela é de R$ ${saldoAntes.toFixed(
                  2
                )}.`,

              saldoParcela: saldoAntes,
              valorInformado: valorParcelaNumero,
            });
          }

          db.serialize(() => {
            db.run("BEGIN TRANSACTION");

            db.run(
              `
                INSERT INTO recebimentos_parcelas (
                  pagamento_id,
                  data_recebimento,
                  valor_recebido,
                  juros,
                  multa,
                  desconto,
                  observacoes,
                  tipo
                )
                VALUES (?, ?, ?, 0, 0, 0, ?, 'Parcela')
              `,
              [
    parcelaId,
    dataPagamentoFinal,
    valorParcelaNumero,
    observacoes,
],
              function (erroRecebimento) {
                if (erroRecebimento) {
                  console.error(
                    "Erro ao registrar parcela:",
                    erroRecebimento
                  );

                  db.run("ROLLBACK");

                  return res.status(500).json({
                    erro:
                      "Erro ao registrar o recebimento da parcela.",
                  });
                }

                const recebimentoId = this.lastID;

                const totalAplicado =
                  totalAplicadoAnterior +
                  valorParcelaNumero;

                const saldoRestante = Math.max(
                  valorOriginal - totalAplicado,
                  0
                );

                const novoStatus =
                  saldoRestante <= toleranciaCentavos
                    ? "Pago"
                    : "Parcial";

                db.run(
                  `
                    UPDATE pagamentos
                    SET
                      status = ?,
                      data_pagamento = ?,
                      observacoes = ?
                    WHERE id = ?
                  `,
                  [
                    novoStatus,
                    dataPagamentoFinal,
                    observacoes,
                    parcelaId,
                  ],
                  function (erroAtualizacao) {
                    if (erroAtualizacao) {
                      console.error(
                        "Erro ao atualizar parcela:",
                        erroAtualizacao
                      );

                      db.run("ROLLBACK");

                      return res.status(500).json({
                        erro:
                          "Erro ao atualizar a situação da parcela.",
                      });
                    }

                    registrarMovimentacao(
                      parcela.emprestimo_id,
                      novoStatus === "Pago"
                        ? "Recebimento de Parcela"
                        : "Recebimento Parcial",
                      `Parcela ${
                        parcela.parcela
                      } — recebimento de R$ ${valorParcelaNumero.toFixed(
                        2
                      )}`,
                      valorParcelaNumero
                    );

                    db.run(
                      "COMMIT",
                      (erroCommit) => {
                        if (erroCommit) {
                          console.error(
                            "Erro ao confirmar recebimento:",
                            erroCommit
                          );

                          db.run("ROLLBACK");

                          return res.status(500).json({
                            erro:
                              "Erro ao confirmar o recebimento.",
                          });
                        }

                        return res.json({
                          sucesso: true,

                          mensagem:
                            novoStatus === "Pago"
                              ? "Parcela quitada com sucesso."
                              : "Recebimento parcial registrado com sucesso.",

                          tipo: "Parcela",
                          recebimentoId,
                          parcelaId,
                          parcela: parcela.parcela,
                          dataPagamento:
                            dataPagamentoFinal,
                          valorOriginal,
                          saldoAntes,
                          valorRecebido:
                            valorParcelaNumero,
                          totalAplicado,
                          saldoRestante,
                          status: novoStatus,
                        });
                      }
                    );
                  }
                );
              }
            );
          });
        }
      );
    }
  );
});

// ========================================
// ANTECIPAR PARCELAS (com desconto por valor presente)
// ========================================
//
// Reaproveita exatamente o mesmo mecanismo de PUT /pagamentos/:id:
// INSERT em recebimentos_parcelas (tipo='Parcela') + UPDATE do status
// bruto da parcela para 'Pago'. Isso é o que já faz valor_a_receber
// (GET /emprestimos), parcelas_pagas/parcelas_pendentes
// (GET /historico-emprestimo/:id) e o saldo_restante/status_calculado
// (GET /pagamentos/:emprestimoId, já ajustado para somar o desconto)
// funcionarem automaticamente, sem precisar de nenhuma coluna nova.

// Taxa fixa usada exclusivamente para calcular o desconto de antecipação
// — não é a taxa do contrato (essa continua intocada em juros/parcelas/
// valor_a_receber). Trazer o juros futuro a valor presente com uma taxa
// menor que a do contrato resulta num desconto menor.
const TAXA_ANTECIPACAO = 4;

app.post("/emprestimos/:id/antecipar-parcelas", (req, res) => {

    const emprestimoId = req.params.id;

    const {
        parcelasIds,
        dataPagamento,
        observacao = ""
    } = req.body;

    const dataPagamentoFinal =
        dataPagamento || new Date().toISOString().split("T")[0];

    const idsUnicos = Array.isArray(parcelasIds)
        ? [...new Set(parcelasIds.map((id) => Number(id)))].filter(
            (id) => Number.isInteger(id) && id > 0
        )
        : [];

    if (idsUnicos.length === 0) {
        return res.status(400).json({
            erro: "Selecione ao menos uma parcela para antecipar."
        });
    }

    db.get(
        `SELECT * FROM emprestimos WHERE id = ?`,
        [emprestimoId],
        (erroEmprestimo, emprestimo) => {

            if (erroEmprestimo) {
                console.error(
                    "Erro ao buscar contrato para antecipação:",
                    erroEmprestimo
                );
                return res.status(500).json({
                    erro: "Erro ao localizar o contrato."
                });
            }

            if (!emprestimo) {
                return res.status(404).json({
                    erro: "Contrato não encontrado."
                });
            }

            if (emprestimo.status !== "Ativo") {
                return res.status(400).json({
                    erro:
                        "Somente contratos Ativos podem ter parcelas antecipadas. Contratos quitados ou renegociados fazem parte do histórico financeiro."
                });
            }

            if (emprestimo.tipo_emprestimo !== "parcelas_fixas") {
                return res.status(400).json({
                    erro:
                        "A antecipação de parcelas está disponível apenas para contratos de Parcelas Fixas."
                });
            }

            db.all(
                `
                SELECT
                    p.id,
                    p.parcela,
                    p.vencimento,
                    p.valor,
                    p.status,
                    COALESCE(
                        SUM(
                            CASE
                                WHEN r.tipo = 'Parcela'
                                THEN r.valor_recebido + r.desconto
                                ELSE 0
                            END
                        ),
                        0
                    ) AS totalAplicado
                FROM pagamentos p
                LEFT JOIN recebimentos_parcelas r
                    ON r.pagamento_id = p.id
                WHERE p.emprestimo_id = ?
                GROUP BY p.id
                ORDER BY p.vencimento
                `,
                [emprestimoId],
                (erroParcelas, todasParcelas) => {

                    if (erroParcelas) {
                        console.error(
                            "Erro ao verificar parcelas para antecipação:",
                            erroParcelas
                        );
                        return res.status(500).json({
                            erro: "Erro ao verificar as parcelas selecionadas."
                        });
                    }

                    const parcelas = todasParcelas.filter(
                        (parcela) => idsUnicos.includes(parcela.id)
                    );

                    if (parcelas.length !== idsUnicos.length) {
                        return res.status(400).json({
                            erro: "Uma ou mais parcelas selecionadas não pertencem a este contrato."
                        });
                    }

                    const parcelasJaPagas = parcelas.filter(
                        (parcela) => Number(parcela.totalAplicado) > 0.009
                    );

                    if (parcelasJaPagas.length > 0) {
                        return res.status(409).json({
                            erro:
                                `A parcela ${parcelasJaPagas[0].parcela} já possui recebimento registrado. ` +
                                `Atualize a lista de parcelas e tente novamente.`
                        });
                    }

                    // A "próxima parcela pendente" do CONTRATO (não só das
                    // selecionadas) é a âncora da antecipação — é a partir
                    // dela, não da data de hoje, que se conta quantos meses
                    // uma parcela selecionada está sendo antecipada.
                    const parcelasPendentes = todasParcelas
                        .filter((parcela) => Number(parcela.totalAplicado) <= 0.009)
                        .sort((a, b) => (a.vencimento || "").localeCompare(b.vencimento || ""));

                    if (parcelasPendentes.length === 0) {
                        return res.status(400).json({
                            erro: "Este contrato não possui parcelas pendentes."
                        });
                    }

                    const proximaPendente = parcelasPendentes[0];

                    const vencimentoProximaObj = new Date(
                        `${proximaPendente.vencimento}T00:00:00`
                    );

                    const quantidadeParcelasContrato = Number(emprestimo.parcelas) || 1;

                    const principalPorParcela =
                        Number(emprestimo.valor) / quantidadeParcelasContrato;

                    const dataPagamentoObj = new Date(
                        `${dataPagamentoFinal}T00:00:00`
                    );

                    function diferencaMeses(dataBase, dataAlvo) {
                        return (
                            (dataAlvo.getFullYear() - dataBase.getFullYear()) * 12 +
                            (dataAlvo.getMonth() - dataBase.getMonth())
                        );
                    }

                    // Recalcula tudo no servidor — nunca confia em valores
                    // vindos do frontend, que só simula. O desconto incide
                    // somente sobre os juros embutidos na parcela; o
                    // principal é sempre cobrado integralmente.
                    const parcelasCalculadas = parcelas.map((parcela) => {

                        const valorOriginal = Number(parcela.valor) || 0;

                        const jurosPorParcela = Math.max(
                            0,
                            valorOriginal - principalPorParcela
                        );

                        const vencimentoObj = new Date(
                            `${parcela.vencimento}T00:00:00`
                        );

                        // Parcela já vencida ou que vence no mês do
                        // pagamento não recebe desconto, mesmo que esteja
                        // à frente da próxima pendente na fórmula abaixo.
                        const parcelaVencidaOuMesAtual =
                            diferencaMeses(dataPagamentoObj, vencimentoObj) <= 0;

                        const mesesAntecipados = parcelaVencidaOuMesAtual
                            ? 0
                            : Math.max(0, diferencaMeses(vencimentoProximaObj, vencimentoObj));

                        const jurosComDesconto =
                            mesesAntecipados > 0
                                ? jurosPorParcela / Math.pow(1 + TAXA_ANTECIPACAO / 100, mesesAntecipados)
                                : jurosPorParcela;

                        const valorAntecipado = principalPorParcela + jurosComDesconto;

                        const desconto = Math.max(
                            0,
                            valorOriginal - valorAntecipado
                        );

                        return {
                            id: parcela.id,
                            numeroParcela: parcela.parcela,
                            valorOriginal,
                            principalPorParcela,
                            jurosPorParcela,
                            mesesAntecipados,
                            valorAntecipado,
                            desconto
                        };
                    });

                    const totalRecebidoAgora = parcelasCalculadas.reduce(
                        (soma, item) => soma + item.valorAntecipado, 0
                    );

                    const totalDesconto = parcelasCalculadas.reduce(
                        (soma, item) => soma + item.desconto, 0
                    );

                    db.serialize(() => {

                        db.run("BEGIN TRANSACTION");

                        let processadas = 0;
                        let houveErro = false;

                        function registrarProximaParcela(indice) {

                            if (houveErro) return;

                            if (indice >= parcelasCalculadas.length) {
                                return finalizarTransacao();
                            }

                            const item = parcelasCalculadas[indice];

                            const observacaoRecebimento =
                                item.mesesAntecipados > 0
                                    ? `Antecipação de ${item.mesesAntecipados} mês(es). ` +
                                      `Desconto de R$ ${item.desconto.toFixed(2)}.` +
                                      (observacao?.trim() ? ` ${observacao.trim()}` : "")
                                    : (observacao?.trim() || "");

                            db.run(
                                `
                                INSERT INTO recebimentos_parcelas (
                                    pagamento_id,
                                    data_recebimento,
                                    valor_recebido,
                                    juros,
                                    multa,
                                    desconto,
                                    observacoes,
                                    tipo
                                )
                                VALUES (?, ?, ?, 0, 0, ?, ?, 'Parcela')
                                `,
                                [
                                    item.id,
                                    dataPagamentoFinal,
                                    item.valorAntecipado,
                                    item.desconto,
                                    observacaoRecebimento
                                ],
                                function (erroInsert) {

                                    if (erroInsert) {
                                        houveErro = true;
                                        console.error(
                                            "Erro ao registrar recebimento antecipado:",
                                            erroInsert
                                        );
                                        db.run("ROLLBACK");
                                        return res.status(500).json({
                                            erro: "Erro ao registrar a antecipação da parcela."
                                        });
                                    }

                                    db.run(
                                        `
                                        UPDATE pagamentos
                                        SET status = 'Pago', data_pagamento = ?
                                        WHERE id = ?
                                        `,
                                        [dataPagamentoFinal, item.id],
                                        (erroUpdate) => {

                                            if (erroUpdate) {
                                                houveErro = true;
                                                console.error(
                                                    "Erro ao atualizar parcela antecipada:",
                                                    erroUpdate
                                                );
                                                db.run("ROLLBACK");
                                                return res.status(500).json({
                                                    erro: "Erro ao atualizar a parcela antecipada."
                                                });
                                            }

                                            registrarMovimentacao(
                                                emprestimoId,
                                                item.mesesAntecipados > 0
                                                    ? "Antecipação de Parcela"
                                                    : "Recebimento de Parcela",
                                                item.mesesAntecipados > 0
                                                    ? `Parcela ${item.numeroParcela} antecipada. Valor original R$ ${item.valorOriginal.toFixed(2)}, ` +
                                                      `desconto R$ ${item.desconto.toFixed(2)}, valor recebido R$ ${item.valorAntecipado.toFixed(2)}.`
                                                    : `Parcela ${item.numeroParcela} — recebimento de R$ ${item.valorAntecipado.toFixed(2)}`,
                                                item.valorAntecipado
                                            );

                                            processadas++;
                                            registrarProximaParcela(indice + 1);
                                        }
                                    );
                                }
                            );
                        }

                        function finalizarTransacao() {

                            if (parcelasCalculadas.length > 1) {
                                registrarMovimentacao(
                                    emprestimoId,
                                    "Recebimento de parcelas com antecipação",
                                    `${processadas} parcela(s) recebida(s) ` +
                                    `(${parcelasCalculadas.map((p) => p.numeroParcela).join(", ")}), ` +
                                    `com desconto total de R$ ${totalDesconto.toFixed(2)}.`,
                                    null
                                );
                            }

                            db.run("COMMIT", (erroCommit) => {

                                if (erroCommit) {
                                    db.run("ROLLBACK");
                                    console.error(
                                        "Erro ao concluir a antecipação:",
                                        erroCommit
                                    );
                                    return res.status(500).json({
                                        erro: "Erro ao concluir a antecipação das parcelas."
                                    });
                                }

                                res.json({
                                    sucesso: true,
                                    mensagem: "Parcelas antecipadas com sucesso!",
                                    parcelasProcessadas: processadas,
                                    totalRecebidoAgora,
                                    totalDesconto,
                                    parcelas: parcelasCalculadas
                                });
                            });
                        }

                        registrarProximaParcela(0);
                    });
                }
            );
        }
    );

});

// ========================================
// RECEBER SOMENTE JUROS
// ========================================

app.post("/emprestimos/:id/receber-juros", (req, res) => {
    const emprestimoId = req.params.id;

    const {
        valorRecebido,
        jurosAdicional,
        multa,
        desconto,
        observacoes
    } = req.body;

    const agora = new Date();
    const data = agora.toISOString().split("T")[0];
    const hora = agora.toLocaleTimeString("pt-BR");

    const valorFinal =
        (Number(valorRecebido) || 0) +
        (Number(jurosAdicional) || 0) +
        (Number(multa) || 0) -
        (Number(desconto) || 0);

    const descricao =
        observacoes?.trim() ||
        "Recebimento somente dos juros do contrato";

    db.run(
        `
        INSERT INTO movimentacoes (
            emprestimo_id,
            data,
            hora,
            tipo,
            descricao,
            valor
        )
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
            emprestimoId,
            data,
            hora,
            "Recebimento de Juros",
            descricao,
            valorFinal
        ],
        function (err) {
            if (err) {
                console.error(
                    "ERRO AO REGISTRAR RECEBIMENTO DE JUROS:",
                    err
                );

                return res.status(500).json({
                    erro: "Erro ao registrar o recebimento de juros."
                });
            }

            return res.json({
                sucesso: true,
                movimentacaoId: this.lastID,
                valorRecebido: valorFinal
            });
        }
    );
});

// ========================================
// AMORTIZAR SALDO DO EMPRÉSTIMO
// ========================================

app.post("/emprestimos/:id/amortizar", (req, res) => {

    const emprestimoId = req.params.id;

    const {
        valor,
        data_amortizacao,
        observacao
    } = req.body;

    const valorAmortizacao = Number(valor);

    if (
        !Number.isFinite(valorAmortizacao) ||
        valorAmortizacao <= 0
    ) {
        return res.status(400).json({
            erro: "Informe um valor de amortização válido."
        });
    }

    db.get(
        `
        SELECT *
        FROM emprestimos
        WHERE id = ?
        `,
        [emprestimoId],
        (erroBusca, emprestimo) => {

            if (erroBusca) {
                console.error(
                    "Erro ao buscar empréstimo:",
                    erroBusca
                );

                return res.status(500).json({
                    erro: "Erro ao localizar o empréstimo."
                });
            }

            if (!emprestimo) {
                return res.status(404).json({
                    erro: "Empréstimo não encontrado."
                });
            }

            const saldoAtual = Number(
                emprestimo.saldo_devedor ??
                emprestimo.valor ??
                0
            );

            if (valorAmortizacao > saldoAtual) {
                return res.status(400).json({
                    erro:
                        "O valor da amortização não pode ser maior que o saldo devedor."
                });
            }

            const novoSaldo =
                saldoAtual - valorAmortizacao;

            const data =
                data_amortizacao ||
                new Date().toISOString().split("T")[0];

            const hora =
                new Date().toLocaleTimeString("pt-BR");

            const descricao =
                observacao?.trim() ||
                `Amortização de saldo no valor de R$ ${valorAmortizacao.toFixed(2)}`;

            db.serialize(() => {

                db.run("BEGIN TRANSACTION");

                db.run(
                    `
                    UPDATE emprestimos
                    SET saldo_devedor = ?
                    WHERE id = ?
                    `,
                    [
                        novoSaldo,
                        emprestimoId
                    ],
                    function (erroAtualizacao) {

                        if (erroAtualizacao) {

                            db.run("ROLLBACK");

                            console.error(
                                "Erro ao atualizar saldo:",
                                erroAtualizacao
                            );

                            return res.status(500).json({
                                erro:
                                    "Erro ao atualizar o saldo devedor."
                            });
                        }

                        db.run(
                            `
                            INSERT INTO movimentacoes
                            (
                                emprestimo_id,
                                data,
                                hora,
                                tipo,
                                descricao,
                                valor
                            )
                            VALUES (?, ?, ?, ?, ?, ?)
                            `,
                            [
                                emprestimoId,
                                data,
                                hora,
                                "Amortização",
                                descricao,
                                valorAmortizacao
                            ],
                            function (erroMovimentacao) {

                                if (erroMovimentacao) {

                                    db.run("ROLLBACK");

                                    console.error(
                                        "Erro ao registrar amortização:",
                                        erroMovimentacao
                                    );

                                    return res.status(500).json({
                                        erro:
                                            "Erro ao registrar a movimentação."
                                    });
                                }

                                db.run(
                                    "COMMIT",
                                    erroCommit => {

                                        if (erroCommit) {

                                            db.run("ROLLBACK");

                                            return res.status(500).json({
                                                erro:
                                                    "Erro ao concluir a amortização."
                                            });
                                        }

                                        return res.json({
                                            sucesso: true,
                                            mensagem:
                                                "Amortização registrada com sucesso!",
                                            saldoAnterior: saldoAtual,
                                            valorAmortizado:
                                                valorAmortizacao,
                                            novoSaldo
                                        });
                                    }
                                );
                            }
                        );
                    }
                );
            });
        }
    );
});

// ========================================
// QUITAR CONTRATO
// ========================================

app.post("/emprestimos/:id/quitar", (req, res) => {

    const emprestimoId = req.params.id;

    const {
        data_quitacao,
        multa,
        desconto,
        observacao
    } = req.body;

    const valorMulta = Number(multa) || 0;
    const valorDesconto = Number(desconto) || 0;

    db.get(
        `
        SELECT
            e.*,

            COALESCE(
                (
                    SELECT SUM(p.valor)
                    FROM pagamentos p
                    WHERE p.emprestimo_id = e.id
                    AND p.status = 'Pendente'
                ),
                0
            )

            -

            COALESCE(
                (
                    SELECT SUM(m.valor)
                    FROM movimentacoes m
                    WHERE m.emprestimo_id = e.id
                    AND m.tipo = 'Amortização'
                ),
                0
            ) AS valor_a_receber

        FROM emprestimos e
        WHERE e.id = ?
        `,
        [emprestimoId],
        (erroBusca, emprestimo) => {

            if (erroBusca) {
                console.error(
                    "Erro ao buscar contrato:",
                    erroBusca
                );

                return res.status(500).json({
                    erro: "Erro ao localizar o contrato."
                });
            }

            if (!emprestimo) {
                return res.status(404).json({
                    erro: "Contrato não encontrado."
                });
            }

            if (emprestimo.status === "Quitado") {
                return res.status(400).json({
                    erro: "Este contrato já está quitado."
                });
            }

            if (emprestimo.status === "Renegociado") {
                return res.status(400).json({
                    erro:
                        "Um contrato renegociado não pode ser quitado diretamente."
                });
            }

            const saldoAtual = Math.max(
                Number(emprestimo.valor_a_receber || 0),
                0
            );

            if (saldoAtual <= 0) {
                return res.status(400).json({
                    erro:
                        "Este contrato não possui saldo pendente."
                });
            }

            if (
                valorDesconto >
                saldoAtual + valorMulta
            ) {
                return res.status(400).json({
                    erro:
                        "O desconto não pode ser maior que o valor da quitação."
                });
            }

            const valorRecebido =
                saldoAtual +
                valorMulta -
                valorDesconto;

            const data =
                data_quitacao ||
                new Date().toISOString().split("T")[0];

            const hora =
                new Date().toLocaleTimeString("pt-BR");

            const descricao =
                observacao?.trim() ||
                `Quitação total do contrato ${emprestimo.contrato}`;

            db.serialize(() => {

                db.run("BEGIN TRANSACTION");

                db.run(
                    `
                    UPDATE emprestimos
                    SET
                        status = 'Quitado',
                        saldo_devedor = 0
                    WHERE id = ?
                    `,
                    [emprestimoId],
                    function (erroContrato) {

                        if (erroContrato) {
                            db.run("ROLLBACK");

                            return res.status(500).json({
                                erro:
                                    "Erro ao atualizar o contrato."
                            });
                        }

                        db.run(
                            `
                            UPDATE pagamentos
                            SET status = 'Quitada'
                            WHERE emprestimo_id = ?
                            AND status = 'Pendente'
                            `,
                            [emprestimoId],
                            function (erroParcelas) {

                                if (erroParcelas) {
                                    db.run("ROLLBACK");

                                    return res.status(500).json({
                                        erro:
                                            "Erro ao baixar as parcelas."
                                    });
                                }

                                db.run(
                                    `
                                    INSERT INTO movimentacoes
                                    (
                                        emprestimo_id,
                                        data,
                                        hora,
                                        tipo,
                                        descricao,
                                        valor
                                    )
                                    VALUES (?, ?, ?, ?, ?, ?)
                                    `,
                                    [
                                        emprestimoId,
                                        data,
                                        hora,
                                        "Quitação",
                                        descricao,
                                        valorRecebido
                                    ],
                                    function (erroMovimentacao) {

                                        if (erroMovimentacao) {
                                            db.run("ROLLBACK");

                                            return res.status(500).json({
                                                erro:
                                                    "Erro ao registrar a quitação."
                                            });
                                        }

                                        db.run(
                                            "COMMIT",
                                            erroCommit => {

                                                if (erroCommit) {
                                                    db.run("ROLLBACK");

                                                    return res
                                                        .status(500)
                                                        .json({
                                                            erro:
                                                                "Erro ao concluir a quitação."
                                                        });
                                                }

                                                return res.json({
                                                    sucesso: true,
                                                    mensagem:
                                                        "Contrato quitado com sucesso!",
                                                    saldoQuitado:
                                                        saldoAtual,
                                                    multa:
                                                        valorMulta,
                                                    desconto:
                                                        valorDesconto,
                                                    valorRecebido
                                                });
                                            }
                                        );
                                    }
                                );
                            }
                        );
                    }
                );
            });
        }
    );
});

// ========================================
// RECEBER PRINCIPAL (PAGAMENTO MENSAL DE JUROS)
// ========================================

app.post("/emprestimos/:id/receber-principal", (req, res) => {

    const emprestimoId = req.params.id;

    const { observacoes } = req.body;

    db.get(
        `SELECT * FROM emprestimos WHERE id = ?`,
        [emprestimoId],
        (erroBusca, emprestimo) => {

            if (erroBusca) {
                console.error(
                    "Erro ao buscar contrato:",
                    erroBusca
                );

                return res.status(500).json({
                    erro: "Erro ao localizar o contrato."
                });
            }

            if (!emprestimo) {
                return res.status(404).json({
                    erro: "Contrato não encontrado."
                });
            }

            if (emprestimo.tipo_emprestimo !== "juros_mensal") {
                return res.status(400).json({
                    erro:
                        "O recebimento do principal só está disponível para contratos de Pagamento Mensal de Juros."
                });
            }

            if (emprestimo.status !== "Ativo") {
                return res.status(400).json({
                    erro:
                        "Este contrato não está ativo e não pode receber o principal."
                });
            }

            const valorPrincipal = Number(emprestimo.valor) || 0;

            if (valorPrincipal <= 0) {
                return res.status(400).json({
                    erro: "Este contrato não possui valor principal válido."
                });
            }

            const data = new Date().toISOString().split("T")[0];
            const hora = new Date().toLocaleTimeString("pt-BR");

            const descricao =
                observacoes?.trim() ||
                `Recebimento do valor principal do contrato ${emprestimo.contrato}`;

            db.serialize(() => {

                db.run("BEGIN TRANSACTION");

                db.run(
                    `
                    UPDATE emprestimos
                    SET
                        status = 'Quitado',
                        saldo_devedor = 0
                    WHERE id = ?
                    `,
                    [emprestimoId],
                    function (erroContrato) {

                        if (erroContrato) {
                            db.run("ROLLBACK");

                            return res.status(500).json({
                                erro: "Erro ao atualizar o contrato."
                            });
                        }

                        db.run(
                            `
                            UPDATE pagamentos
                            SET status = 'Quitada'
                            WHERE emprestimo_id = ?
                            AND status = 'Pendente'
                            `,
                            [emprestimoId],
                            function (erroParcelas) {

                                if (erroParcelas) {
                                    db.run("ROLLBACK");

                                    return res.status(500).json({
                                        erro: "Erro ao baixar as parcelas."
                                    });
                                }

                                db.run(
                                    `
                                    INSERT INTO movimentacoes
                                    (
                                        emprestimo_id,
                                        data,
                                        hora,
                                        tipo,
                                        descricao,
                                        valor
                                    )
                                    VALUES (?, ?, ?, ?, ?, ?)
                                    `,
                                    [
                                        emprestimoId,
                                        data,
                                        hora,
                                        "Recebimento do Principal",
                                        descricao,
                                        valorPrincipal
                                    ],
                                    function (erroMovimentacao) {

                                        if (erroMovimentacao) {
                                            db.run("ROLLBACK");

                                            return res.status(500).json({
                                                erro:
                                                    "Erro ao registrar o recebimento do principal."
                                            });
                                        }

                                        db.run(
                                            "COMMIT",
                                            erroCommit => {

                                                if (erroCommit) {
                                                    db.run("ROLLBACK");

                                                    return res
                                                        .status(500)
                                                        .json({
                                                            erro:
                                                                "Erro ao concluir o recebimento."
                                                        });
                                                }

                                                return res.json({
                                                    sucesso: true,
                                                    mensagem:
                                                        "Recebimento do principal registrado com sucesso!",
                                                    valorRecebido:
                                                        valorPrincipal
                                                });
                                            }
                                        );
                                    }
                                );
                            }
                        );
                    }
                );
            });
        }
    );
});

// ========================================
// RENOVAR CONTRATO (PAGAMENTO MENSAL DE JUROS)
// ========================================

app.post("/emprestimos/:id/renovar", (req, res) => {

    const emprestimoId = req.params.id;

    const { novaTaxa, novasParcelas, observacao } = req.body;

    const taxaNova = Number(novaTaxa);
    const quantidadeParcelas = Number(novasParcelas);

    if (!Number.isFinite(taxaNova) || taxaNova < 0) {
        return res.status(400).json({
            erro: "Informe uma nova taxa de juros válida."
        });
    }

    if (!Number.isFinite(quantidadeParcelas) || quantidadeParcelas < 1) {
        return res.status(400).json({
            erro: "Informe um novo prazo (parcelas) válido."
        });
    }

    db.get(
        `SELECT * FROM emprestimos WHERE id = ?`,
        [emprestimoId],
        (erroBusca, emprestimo) => {

            if (erroBusca) {
                console.error(
                    "Erro ao buscar contrato:",
                    erroBusca
                );

                return res.status(500).json({
                    erro: "Erro ao localizar o contrato."
                });
            }

            if (!emprestimo) {
                return res.status(404).json({
                    erro: "Contrato não encontrado."
                });
            }

            if (emprestimo.tipo_emprestimo !== "juros_mensal") {
                return res.status(400).json({
                    erro:
                        "A renovação só está disponível para contratos de Pagamento Mensal de Juros."
                });
            }

            if (emprestimo.status !== "Ativo") {
                return res.status(400).json({
                    erro:
                        "Este contrato não está ativo e não pode ser renovado."
                });
            }

            db.get(
                `SELECT contrato
                 FROM emprestimos
                 ORDER BY id DESC
                 LIMIT 1`,
                [],
                (erroContrato, ultimo) => {

                    if (erroContrato) {
                        return res.status(500).json(erroContrato);
                    }

                    let numero = 1;

                    if (ultimo && ultimo.contrato) {
                        numero =
                            parseInt(ultimo.contrato.split("-")[2]) + 1;
                    }

                    const novoContrato =
                        `AX-2026-${numero.toString().padStart(6, "0")}`;

                    const dataRenovacao = new Date();

                    const primeiroVencimentoData = new Date(
                        dataRenovacao
                    );
                    primeiroVencimentoData.setMonth(
                        primeiroVencimentoData.getMonth() + 1
                    );

                    const principal = Number(emprestimo.valor) || 0;
                    const jurosMes = principal * (taxaNova / 100);

                    const descricaoAntigo =
                        observacao?.trim() ||
                        `Contrato ${emprestimo.contrato} renovado e substituído pelo contrato ${novoContrato}.`;

                    const descricaoNovo =
                        observacao?.trim() ||
                        `Novo contrato ${novoContrato} originado da renovação do contrato ${emprestimo.contrato}.`;

                    db.serialize(() => {

                        db.run("BEGIN TRANSACTION");

                        db.run(
                            `INSERT INTO emprestimos
                            (
                                contrato,
                                cliente,
                                valor,
                                juros,
                                parcelas,
                                dataEmprestimo,
                                primeiroVencimento,
                                observacoes,
                                status,
                                emprestimo_origem_id,
                                tipo_emprestimo,
                                saldo_devedor,
                                criadoEm
                            )
                            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                            [
                                novoContrato,
                                emprestimo.cliente,
                                principal,
                                taxaNova,
                                quantidadeParcelas,
                                dataRenovacao
                                    .toISOString()
                                    .split("T")[0],
                                primeiroVencimentoData
                                    .toISOString()
                                    .split("T")[0],
                                observacao,
                                "Ativo",
                                emprestimo.id,
                                "juros_mensal",
                                principal,
                                obterDataHoraCriacaoBrasilia()
                            ],
                            function (erroInsert) {

                                if (erroInsert) {
                                    db.run("ROLLBACK");

                                    console.error(
                                        "Erro ao criar contrato renovado:",
                                        erroInsert
                                    );

                                    return res.status(500).json({
                                        erro:
                                            "Erro ao criar o novo contrato."
                                    });
                                }

                                const novoId = this.lastID;

                                for (
                                    let i = 1;
                                    i <= quantidadeParcelas;
                                    i++
                                ) {

                                    const valorParcela =
                                        i < quantidadeParcelas
                                            ? jurosMes
                                            : principal + jurosMes;

                                    const vencimento = new Date(
                                        primeiroVencimentoData
                                    );
                                    vencimento.setMonth(
                                        vencimento.getMonth() +
                                            (i - 1)
                                    );

                                    db.run(
                                        `INSERT INTO pagamentos
                                        (emprestimo_id, parcela, valor, vencimento, status)
                                        VALUES (?, ?, ?, ?, ?)`,
                                        [
                                            novoId,
                                            i,
                                            valorParcela,
                                            vencimento
                                                .toISOString()
                                                .split("T")[0],
                                            "Pendente"
                                        ]
                                    );

                                }

                                db.run(
                                    `UPDATE emprestimos
                                     SET status = 'Renovado',
                                         emprestimo_filho_id = ?
                                     WHERE id = ?`,
                                    [novoId, emprestimo.id]
                                );

                                db.run(
                                    `UPDATE pagamentos
                                     SET status = 'Renovada'
                                     WHERE emprestimo_id = ?
                                     AND status = 'Pendente'`,
                                    [emprestimo.id]
                                );

                                registrarMovimentacao(
                                    emprestimo.id,
                                    "Renovação de Contrato",
                                    descricaoAntigo,
                                    principal
                                );

                                registrarMovimentacao(
                                    novoId,
                                    "Renovação de Contrato",
                                    descricaoNovo,
                                    principal
                                );

                                db.run(
                                    "COMMIT",
                                    erroCommit => {

                                        if (erroCommit) {
                                            db.run("ROLLBACK");

                                            return res
                                                .status(500)
                                                .json({
                                                    erro:
                                                        "Erro ao concluir a renovação."
                                                });
                                        }

                                        return res.json({
                                            sucesso: true,
                                            contrato: novoContrato,
                                            id: novoId
                                        });
                                    }
                                );
                            }
                        );
                    });
                }
            );
        }
    );
});

// ========================================
// REAJUSTAR TAXA DE JUROS (PAGAMENTO MENSAL DE JUROS)
// ========================================

app.post("/emprestimos/:id/reajustar-taxa", (req, res) => {

    const emprestimoId = req.params.id;

    const { novaTaxa, dataInicio, observacoes } = req.body;

    const taxaNova = Number(novaTaxa);

    if (!Number.isFinite(taxaNova) || taxaNova < 0) {
        return res.status(400).json({
            erro: "Informe uma nova taxa de juros válida."
        });
    }

    if (!dataInicio) {
        return res.status(400).json({
            erro: "Informe a data de início do reajuste."
        });
    }

    db.get(
        `SELECT * FROM emprestimos WHERE id = ?`,
        [emprestimoId],
        (erroBusca, emprestimo) => {

            if (erroBusca) {
                console.error(
                    "Erro ao buscar contrato:",
                    erroBusca
                );

                return res.status(500).json({
                    erro: "Erro ao localizar o contrato."
                });
            }

            if (!emprestimo) {
                return res.status(404).json({
                    erro: "Contrato não encontrado."
                });
            }

            if (emprestimo.tipo_emprestimo !== "juros_mensal") {
                return res.status(400).json({
                    erro:
                        "O reajuste de taxa só está disponível para contratos de Pagamento Mensal de Juros."
                });
            }

            if (emprestimo.status !== "Ativo") {
                return res.status(400).json({
                    erro:
                        "Este contrato não está ativo e não pode ter a taxa reajustada."
                });
            }

            const taxaAntiga = emprestimo.juros;
            const principal = Number(emprestimo.valor) || 0;
            const jurosMensalNovo = principal * (taxaNova / 100);

            const descricao =
                `Taxa de juros reajustada de ${taxaAntiga}% para ${taxaNova}% a partir de ${dataInicio}.` +
                (observacoes?.trim() ? ` ${observacoes.trim()}` : "");

            db.serialize(() => {

                db.run("BEGIN TRANSACTION");

                db.run(
                    `UPDATE emprestimos SET juros = ? WHERE id = ?`,
                    [taxaNova, emprestimoId],
                    function (erroTaxa) {

                        if (erroTaxa) {
                            db.run("ROLLBACK");

                            return res.status(500).json({
                                erro: "Erro ao atualizar a taxa do contrato."
                            });
                        }

                        db.run(
                            `
                            UPDATE pagamentos
                            SET valor = CASE
                                WHEN parcela = ? THEN ? + ?
                                ELSE ?
                            END
                            WHERE emprestimo_id = ?
                            AND status = 'Pendente'
                            AND vencimento >= ?
                            `,
                            [
                                emprestimo.parcelas,
                                principal,
                                jurosMensalNovo,
                                jurosMensalNovo,
                                emprestimoId,
                                dataInicio
                            ],
                            function (erroParcelas) {

                                if (erroParcelas) {
                                    db.run("ROLLBACK");

                                    return res.status(500).json({
                                        erro:
                                            "Erro ao recalcular as parcelas futuras."
                                    });
                                }

                                const parcelasAtualizadas =
                                    this.changes;

                                registrarMovimentacao(
                                    emprestimoId,
                                    "Reajuste de Taxa",
                                    descricao,
                                    null
                                );

                                db.run(
                                    "COMMIT",
                                    erroCommit => {

                                        if (erroCommit) {
                                            db.run("ROLLBACK");

                                            return res
                                                .status(500)
                                                .json({
                                                    erro:
                                                        "Erro ao concluir o reajuste."
                                                });
                                        }

                                        return res.json({
                                            sucesso: true,
                                            mensagem:
                                                "Taxa de juros reajustada com sucesso!",
                                            parcelas_atualizadas:
                                                parcelasAtualizadas
                                            }
                                        );
                                    }
                                );
                            }
                        );
                    }
                );
            });
        }
    );
});

// ===================================
// RENEGOCIAR EMPRÉSTIMO
// ===================================

app.post("/renegociar", (req, res) => {

    console.log("ENTROU NA ROTA RENEGOCIAR");
console.log(req.body);

    const {
        emprestimo,
        saldoDevedor,
        novaTaxa,
        novasParcelas,
        observacao
    } = req.body;

    const tipoEmprestimoFinal =
        emprestimo?.tipo_emprestimo === "juros_mensal"
            ? "juros_mensal"
            : "parcelas_fixas";

    db.get(
        `SELECT contrato
         FROM emprestimos
         ORDER BY id DESC
         LIMIT 1`,
        [],
        (erro, ultimo) => {

            if (erro) {
                return res.status(500).json(erro);
            }

            let numero = 1;

            if (ultimo && ultimo.contrato) {

                numero =
                    parseInt(ultimo.contrato.split("-")[2]) + 1;

            }

            const novoContrato =
                `AX-2026-${numero.toString().padStart(6,"0")}`;

            const dataRenegociacao = new Date();

            const primeiroVencimentoData = new Date(dataRenegociacao);
            primeiroVencimentoData.setMonth(
                primeiroVencimentoData.getMonth() + 1
            );

            db.run(

                `INSERT INTO emprestimos
                (
                    contrato,
                    cliente,
                    valor,
                    juros,
                    parcelas,
                    dataEmprestimo,
                    primeiroVencimento,
                    observacoes,
                    status,
                    emprestimo_origem_id,
                    tipo_emprestimo,
                    criadoEm
                )
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,

                [

                    novoContrato,
                    emprestimo.cliente,
                    emprestimo.valor,
                    novaTaxa,
                    novasParcelas,
                    dataRenegociacao.toISOString().split("T")[0],
                    primeiroVencimentoData.toISOString().split("T")[0],
                    observacao,
                    "Ativo",
                    emprestimo.id,
                    tipoEmprestimoFinal,
                    obterDataHoraCriacaoBrasilia()

                ],

                function(err){

    if (err){
        console.log("ERRO SQLITE:");
        console.log(err);
        return res.status(500).json(err);
    }

    console.log("INSERT DO EMPRESTIMO OK");

    const novoId = this.lastID;

    const saldoBase = Number(saldoDevedor) || 0;
    const taxaRenegociada = Number(novaTaxa) || 0;
    const quantidadeParcelas = Number(novasParcelas) || 0;

    const jurosTotalRenegociacao =
          saldoBase *
          (taxaRenegociada / 100) *
          quantidadeParcelas;

    const valorTotalRenegociado =
    saldoBase + jurosTotalRenegociacao;

                  db.run(
`UPDATE emprestimos
SET status = 'Renegociado',
emprestimo_filho_id = ?
WHERE id = ?`,
[novoId, emprestimo.id]
);

db.run(
    `UPDATE pagamentos
     SET status = 'Renegociada'
     WHERE emprestimo_id = ?
     AND status = 'Pendente'`,
    [emprestimo.id],
    function (err) {

        if (err) {
            console.log(err);
        }

        console.log("Parcelas alteradas:", this.changes);

    }
);

console.log("EMPRESTIMO CRIADO");

                    for (let i = 1; i <= novasParcelas; i++) {

    const jurosMes =
    saldoBase * (taxaRenegociada / 100);

    // Parcelas Fixas: amortização + juros todo mês (lógica original, inalterada).
    // Pagamento Mensal de Juros: só juros até a penúltima parcela;
    // a última cobra o saldo integral + o último juros.
    let valorParcela;

    if (tipoEmprestimoFinal === "juros_mensal") {

        valorParcela =
            i < novasParcelas
                ? jurosMes
                : saldoBase + jurosMes;

    } else {

        const amortizacao =
        saldoBase / quantidadeParcelas;

        valorParcela = amortizacao + jurosMes;

    }

    const vencimento = new Date(primeiroVencimentoData);
    vencimento.setMonth(vencimento.getMonth() + (i - 1));

    db.run(
        `INSERT INTO pagamentos
        (emprestimo_id, parcela, valor, vencimento, status)
        VALUES (?, ?, ?, ?, ?)`,
        [
            novoId,
            i,
            valorParcela,
            vencimento.toISOString().split("T")[0],
            "Pendente"
        ]
    );

}

console.log("VAI ATUALIZAR O CONTRATO ANTIGO");

db.run(
"UPDATE emprestimos SET status = 'Renegociado' WHERE id = ?",
[emprestimo.id]
);

db.adicionarExtrato(
    emprestimo.id,
    "RENEGOCIAÇÃO",
    `Contrato ${emprestimo.contrato} renegociado e substituído pelo contrato ${novoContrato}.`,
    valorTotalRenegociado,
    0
);

db.adicionarExtrato(
    novoId,
    "RENEGOCIAÇÃO",
    `Novo contrato ${novoContrato} originado da renegociação do contrato ${emprestimo.contrato}.`,
    valorTotalRenegociado,
    valorTotalRenegociado
);

                    res.json({

                        sucesso:true,

                        contrato:novoContrato,

                        id:novoId

                    });

                }

            );

        }

    );

});

// ============================
// DASHBOARD EMPRÉSTIMOS
// ============================

app.get("/dashboard-emprestimos", (req, res) => {

    // 1. TOTAL ORIGINALMENTE EMPRESTADO
    db.get(
        `
        SELECT
            COALESCE(SUM(valor), 0) AS total_emprestado
        FROM emprestimos
        WHERE emprestimo_origem_id IS NULL
        `,
        [],
        (erroEmprestimos, resultadoEmprestimos) => {

            if (erroEmprestimos) {
                console.error(
                    "Erro ao calcular total emprestado:",
                    erroEmprestimos
                );

                return res.status(500).json({
                    erro:
                        "Erro ao calcular o total emprestado."
                });
            }

            /*
                1.5 DESCONTOS CONCEDIDOS (HISTÓRICO)

                Soma de todo desconto já efetivamente aplicado em
                recebimentos confirmados (hoje, só a antecipação de
                parcelas grava valor em recebimentos_parcelas.desconto —
                quitações com desconto não persistem esse valor em
                nenhuma coluna própria, então não entram aqui ainda).
                Histórico completo: não filtra por status do contrato,
                assim como o Total Recebido também não deveria.
            */
            db.get(
                `
                SELECT
                    COALESCE(SUM(desconto), 0) AS total_descontos
                FROM recebimentos_parcelas
                WHERE COALESCE(desconto, 0) > 0
                `,
                [],
                (erroDescontos, resultadoDescontos) => {

            if (erroDescontos) {
                console.error(
                    "Erro ao calcular descontos concedidos:",
                    erroDescontos
                );

                return res.status(500).json({
                    erro: "Erro ao calcular os descontos concedidos."
                });
            }

            const totalDescontosConcedidos = Number(
                resultadoDescontos.total_descontos || 0
            );

            /*
                2. TOTAL RECEBIDO

                Soma:
                - pagamentos de parcelas;
                - pagamentos somente de juros.

                Os juros também são dinheiro recebido,
                mas não reduzem o saldo da parcela.
            */
            db.get(
                `
                SELECT
                    COALESCE(
                        SUM(r.valor_recebido),
                        0
                    ) AS total_recebido,

                    COALESCE(
                        SUM(
                            CASE
                                WHEN COALESCE(
                                    r.tipo,
                                    'Parcela'
                                ) = 'Parcela'
                                THEN
                                    r.valor_recebido
                                    + COALESCE(r.desconto, 0)

                                ELSE 0
                            END
                        ),
                        0
                    ) AS total_aplicado_parcelas,

                    COALESCE(
                        SUM(
                            CASE
                                WHEN r.tipo = 'Juros'
                                THEN r.valor_recebido
                                ELSE 0
                            END
                        ),
                        0
                    ) AS total_juros_recebidos

                FROM recebimentos_parcelas r

                INNER JOIN pagamentos p
                    ON p.id = r.pagamento_id

                INNER JOIN emprestimos e
                    ON e.id = p.emprestimo_id

                WHERE e.status = 'Ativo'
                `,
                [],
                (
                    erroRecebimentos,
                    resultadoRecebimentos
                ) => {

                    if (erroRecebimentos) {
                        console.error(
                            "Erro ao calcular recebimentos:",
                            erroRecebimentos
                        );

                        return res.status(500).json({
                            erro:
                                "Erro ao calcular os recebimentos."
                        });
                    }

                    /*
                        3. TOTAL A RECEBER

                        Somente pagamentos do tipo Parcela
                        reduzem o saldo.

                        Pagamentos do tipo Juros não reduzem
                        o valor das parcelas.
                    */
                    db.get(
                        `
                        SELECT
                            COALESCE(
                                SUM(
                                    CASE
                                        WHEN
                                            p.valor -
                                            COALESCE(
                                                recebido.total_aplicado,
                                                0
                                            ) > 0

                                        THEN
                                            p.valor -
                                            COALESCE(
                                                recebido.total_aplicado,
                                                0
                                            )

                                        ELSE 0
                                    END
                                ),
                                0
                            ) AS total_receber_parcelas

                        FROM pagamentos p

                        INNER JOIN emprestimos e
                            ON e.id = p.emprestimo_id

                        LEFT JOIN (
                            SELECT
                                pagamento_id,

                                COALESCE(
                                    SUM(
                                        CASE
                                            WHEN COALESCE(
                                                tipo,
                                                'Parcela'
                                            ) = 'Parcela'
                                            THEN
                                                valor_recebido
                                                + COALESCE(
                                                    desconto,
                                                    0
                                                )

                                            ELSE 0
                                        END
                                    ),
                                    0
                                ) AS total_aplicado

                            FROM recebimentos_parcelas

                            GROUP BY pagamento_id
                        ) recebido
                            ON recebido.pagamento_id = p.id

                        WHERE e.status = 'Ativo'
                        `,
                        [],
                        (erroSaldo, resultadoSaldo) => {

                            if (erroSaldo) {
                                console.error(
                                    "Erro ao calcular saldo:",
                                    erroSaldo
                                );

                                return res.status(500).json({
                                    erro:
                                        "Erro ao calcular o saldo das parcelas."
                                });
                            }

                            /*
                                4. MOVIMENTAÇÕES QUE NÃO ESTÃO
                                NA TABELA DE RECEBIMENTOS

                                O "Recebimento de Juros" aqui é o
                                registrado pelo botão de Pagamento
                                Mensal de Juros (POST /receber-juros),
                                que grava em movimentacoes, não em
                                recebimentos_parcelas — diferente dos
                                juros recebidos por parcela (tipo
                                'Juros' em recebimentos_parcelas, esses
                                sim já somados acima).
                            */
                            db.all(
                                `
                                SELECT
                                    m.tipo,
                                    e.status AS status_contrato,
                                    COALESCE(
                                        m.valor,
                                        0
                                    ) AS valor

                                FROM movimentacoes m

                                INNER JOIN emprestimos e
                                    ON e.id = m.emprestimo_id

                                WHERE
                                    e.status IN (
                                        'Ativo',
                                        'Quitado'
                                    )

                                    AND m.tipo IN (
                                        'Amortização',
                                        'Quitação',
                                        'Recebimento do Principal',
                                        'Recebimento de Juros'
                                    )
                                `,
                                [],
                                (
                                    erroMovimentacoes,
                                    movimentacoes
                                ) => {

                                    if (erroMovimentacoes) {
                                        console.error(
                                            "Erro ao consultar movimentações:",
                                            erroMovimentacoes
                                        );

                                        return res
                                            .status(500)
                                            .json({
                                                erro:
                                                    "Erro ao calcular as movimentações."
                                            });
                                    }

                                    const totalEmprestado =
                                        Number(
                                            resultadoEmprestimos
                                                .total_emprestado ||
                                            0
                                        );

                                    const totalRecebidoParcelasEJuros =
                                        Number(
                                            resultadoRecebimentos
                                                .total_recebido ||
                                            0
                                        );

                                    const totalQuitacoes =
                                        movimentacoes
                                            .filter(
                                                item =>
                                                    [
                                                        "Quitação",
                                                        "Recebimento do Principal",
                                                        "Recebimento de Juros"
                                                    ].includes(
                                                        item.tipo
                                                    )
                                            )
                                            .reduce(
                                                (
                                                    soma,
                                                    item
                                                ) =>
                                                    soma +
                                                    Number(
                                                        item.valor ||
                                                        0
                                                    ),
                                                0
                                            );

                                    const totalRecebido =
                                        totalRecebidoParcelasEJuros +
                                        totalQuitacoes;

                                    const totalReceberParcelas =
                                        Number(
                                            resultadoSaldo
                                                .total_receber_parcelas ||
                                            0
                                        );

                                    /*
                                        Só conta, para fins de saldo pendente,
                                        a amortização de contratos que ainda
                                        estão Ativos. Uma amortização de um
                                        contrato que depois foi quitado não
                                        pode continuar "descontando" o saldo
                                        pendente de outros contratos Ativos —
                                        o contrato quitado já sai inteiro da
                                        soma de totalReceberParcelas.
                                    */
                                    const totalAmortizado =
                                        movimentacoes
                                            .filter(
                                                item =>
                                                    item.tipo ===
                                                    "Amortização" &&
                                                    item.status_contrato ===
                                                    "Ativo"
                                            )
                                            .reduce(
                                                (
                                                    soma,
                                                    item
                                                ) =>
                                                    soma +
                                                    Number(
                                                        item.valor ||
                                                        0
                                                    ),
                                                0
                                            );

                                    /*
                                        4.4 JUROS MENSAIS JÁ RECEBIDOS
                                        (PAGAMENTO MENSAL DE JUROS)

                                        POST /emprestimos/:id/receber-juros
                                        só grava em movimentacoes — não baixa
                                        a parcela de juros correspondente em
                                        `pagamentos`/`recebimentos_parcelas`.
                                        Sem este ajuste, totalReceberParcelas
                                        continuaria contando, para sempre,
                                        juros mensais já recebidos. Cada
                                        contrato tem seu crédito limitado ao
                                        total de parcelas só-de-juros dele
                                        (exclui a última parcela, que soma
                                        principal + juros), para não abater
                                        o principal por engano.
                                    */
                                    db.all(
                                        `
                                        SELECT
                                            e.id AS emprestimo_id,

                                            COALESCE((
                                                SELECT SUM(m.valor)
                                                FROM movimentacoes m
                                                WHERE m.emprestimo_id = e.id
                                                AND m.tipo = 'Recebimento de Juros'
                                            ), 0) AS total_juros_recebido,

                                            COALESCE((
                                                SELECT SUM(p.valor)
                                                FROM pagamentos p
                                                WHERE p.emprestimo_id = e.id
                                                AND p.parcela < e.parcelas
                                            ), 0) AS total_juros_pendente_schedule

                                        FROM emprestimos e
                                        WHERE e.status = 'Ativo'
                                        AND e.tipo_emprestimo = 'juros_mensal'
                                        `,
                                        [],
                                        (
                                            erroJurosMensal,
                                            contratosJurosMensal
                                        ) => {

                                    if (erroJurosMensal) {
                                        console.error(
                                            "Erro ao calcular juros mensais recebidos:",
                                            erroJurosMensal
                                        );

                                        return res.status(500).json({
                                            erro:
                                                "Erro ao calcular os juros mensais recebidos."
                                        });
                                    }

                                    const totalJurosMensalCreditado =
                                        (contratosJurosMensal || []).reduce(
                                            (soma, linha) =>
                                                soma +
                                                Math.min(
                                                    Number(
                                                        linha.total_juros_recebido ||
                                                        0
                                                    ),
                                                    Number(
                                                        linha.total_juros_pendente_schedule ||
                                                        0
                                                    )
                                                ),
                                            0
                                        );

                                    const totalReceber =
                                        Math.max(
                                            totalReceberParcelas -
                                            totalAmortizado -
                                            totalJurosMensalCreditado,
                                            0
                                        );

                                    /*
                                        4.5 SALDO DEVEDOR

                                        Soma, para contratos Ativos, o
                                        principal menos o que já foi
                                        amortizado. Não usa a coluna
                                        saldo_devedor (fica NULL em
                                        contratos novos/renovados até o
                                        próximo boot do servidor) — é
                                        recalculado on-the-fly, como o
                                        /quitar já faz.
                                    */
                                    db.get(
                                        `
                                        SELECT
                                            COALESCE(SUM(
                                                e.valor -
                                                COALESCE((
                                                    SELECT SUM(m.valor)
                                                    FROM movimentacoes m
                                                    WHERE m.emprestimo_id = e.id
                                                    AND m.tipo = 'Amortização'
                                                ), 0)
                                            ), 0) AS saldo_devedor_total
                                        FROM emprestimos e
                                        WHERE e.status = 'Ativo'
                                        `,
                                        [],
                                        (
                                            erroSaldoDevedor,
                                            resultadoSaldoDevedor
                                        ) => {

                                    if (erroSaldoDevedor) {
                                        console.error(
                                            "Erro ao calcular saldo devedor:",
                                            erroSaldoDevedor
                                        );

                                        return res.status(500).json({
                                            erro:
                                                "Erro ao calcular o saldo devedor."
                                        });
                                    }

                                    const saldoDevedor = Number(
                                        resultadoSaldoDevedor
                                            .saldo_devedor_total || 0
                                    );

                                    /*
                                        5. PARCELAS ATRASADAS

                                        Somente pagamentos do tipo Parcela
                                        reduzem o saldo considerado no atraso.
                                    */
                                    const hoje =
                                        new Date()
                                            .toISOString()
                                            .split("T")[0];

                                    db.get(
                                        `
                                        SELECT
                                            COUNT(*) AS quantidade

                                        FROM pagamentos p

                                        INNER JOIN emprestimos e
                                            ON e.id =
                                               p.emprestimo_id

                                        LEFT JOIN (
                                            SELECT
                                                pagamento_id,

                                                COALESCE(
                                                    SUM(
                                                        CASE
                                                            WHEN COALESCE(
                                                                tipo,
                                                                'Parcela'
                                                            ) = 'Parcela'

                                                            THEN
                                                                valor_recebido
                                                                +
                                                                COALESCE(
                                                                    desconto,
                                                                    0
                                                                )

                                                            ELSE 0
                                                        END
                                                    ),
                                                    0
                                                ) AS total_aplicado

                                            FROM recebimentos_parcelas

                                            GROUP BY pagamento_id
                                        ) recebido
                                            ON recebido.pagamento_id =
                                               p.id

                                        WHERE
                                            e.status = 'Ativo'

                                            AND p.vencimento < ?

                                            AND COALESCE(
                                                recebido.total_aplicado,
                                                0
                                            ) < p.valor - 0.009
                                        `,
                                        [hoje],
                                        (
                                            erroAtrasadas,
                                            resultadoAtrasadas
                                        ) => {

                                            if (erroAtrasadas) {
                                                console.error(
                                                    "Erro ao calcular parcelas atrasadas:",
                                                    erroAtrasadas
                                                );

                                                return res
                                                    .status(500)
                                                    .json({
                                                        erro:
                                                            "Erro ao calcular as parcelas atrasadas."
                                                    });
                                            }

                                            return res.json({
                                                totalEmprestado,
                                                totalRecebido,
                                                totalReceber,
                                                saldoDevedor,

                                                totalJurosRecebidos:
                                                    Number(
                                                        resultadoRecebimentos
                                                            .total_juros_recebidos ||
                                                        0
                                                    ),

                                                parcelasAtrasadas:
                                                    Number(
                                                        resultadoAtrasadas
                                                            .quantidade ||
                                                        0
                                                    ),

                                                totalDescontosConcedidos
                                            });
                                        }
                                    );
                                    }
                                    );
                                    }
                                    );
                                }
                            );
                        }
                    );
                }
            );
        }
    );
    }
    );
});
// ====================================
// FLUXO DE CAIXA (ÚLTIMOS 6 MESES)
// ====================================

app.get("/fluxo-caixa", (req, res) => {

    const hoje = new Date();

    const meses = [];

    for (let i = 5; i >= 0; i--) {

        const referencia = new Date(
            hoje.getFullYear(),
            hoje.getMonth() - i,
            1
        );

        meses.push(
            `${referencia.getFullYear()}-${String(
                referencia.getMonth() + 1
            ).padStart(2, "0")}`
        );

    }

    const inicio = `${meses[0]}-01`;

    // 1. ENTRADAS: recebimentos de parcelas/juros
    db.all(
        `
        SELECT
            strftime('%Y-%m', data_recebimento) AS mes,
            COALESCE(SUM(valor_recebido), 0) AS total
        FROM recebimentos_parcelas
        WHERE data_recebimento >= ?
        GROUP BY mes
        `,
        [inicio],
        (erroRecebimentos, recebimentos) => {

            if (erroRecebimentos) {
                console.error(
                    "Erro ao calcular entradas (recebimentos):",
                    erroRecebimentos
                );

                return res.status(500).json({
                    erro: "Erro ao calcular o fluxo de caixa."
                });
            }

            // 2. ENTRADAS: movimentações de amortização/quitação/
            //    recebimento do principal/recebimento de juros
            db.all(
                `
                SELECT
                    strftime('%Y-%m', data) AS mes,
                    COALESCE(SUM(valor), 0) AS total
                FROM movimentacoes
                WHERE data >= ?
                AND tipo IN (
                    'Amortização',
                    'Quitação',
                    'Recebimento do Principal',
                    'Recebimento de Juros'
                )
                GROUP BY mes
                `,
                [inicio],
                (erroMovimentacoes, movimentacoes) => {

                    if (erroMovimentacoes) {
                        console.error(
                            "Erro ao calcular entradas (movimentações):",
                            erroMovimentacoes
                        );

                        return res.status(500).json({
                            erro: "Erro ao calcular o fluxo de caixa."
                        });
                    }

                    // 3. SAÍDAS: capital novo emprestado no mês
                    //    (exclui contratos renegociados/renovados,
                    //    que não são dinheiro novo saindo do caixa)
                    db.all(
                        `
                        SELECT
                            strftime('%Y-%m', dataEmprestimo) AS mes,
                            COALESCE(SUM(valor), 0) AS total
                        FROM emprestimos
                        WHERE dataEmprestimo >= ?
                        AND emprestimo_origem_id IS NULL
                        GROUP BY mes
                        `,
                        [inicio],
                        (erroSaidas, saidasPorMes) => {

                            if (erroSaidas) {
                                console.error(
                                    "Erro ao calcular saídas:",
                                    erroSaidas
                                );

                                return res.status(500).json({
                                    erro:
                                        "Erro ao calcular o fluxo de caixa."
                                });
                            }

                            const entradasPorMes = {};

                            for (const linha of recebimentos) {
                                entradasPorMes[linha.mes] =
                                    (entradasPorMes[linha.mes] || 0) +
                                    Number(linha.total || 0);
                            }

                            for (const linha of movimentacoes) {
                                entradasPorMes[linha.mes] =
                                    (entradasPorMes[linha.mes] || 0) +
                                    Number(linha.total || 0);
                            }

                            const saidasMapa = {};

                            for (const linha of saidasPorMes) {
                                saidasMapa[linha.mes] = Number(
                                    linha.total || 0
                                );
                            }

                            const entradas = meses.map(
                                mes => entradasPorMes[mes] || 0
                            );

                            const saidas = meses.map(
                                mes => saidasMapa[mes] || 0
                            );

                            return res.json({
                                meses,
                                entradas,
                                saidas
                            });

                        }
                    );

                }
            );

        }
    );

});

// ====================================================
// EXTRATO MENSAL — CENTRAL DE ANÁLISE DA CARTEIRA
//
// Competência de um contrato é sempre dataEmprestimo
// (nunca criadoEm). Recebimentos são classificados pela
// data real do evento financeiro (data_recebimento em
// recebimentos_parcelas, ou data em movimentacoes) — nunca
// pelo mês do contrato. Um contrato só é excluído de
// "valor emprestado" quando é filho de renegociação/
// renovação (emprestimo_origem_id preenchido), pois nesse
// caso o campo valor apenas repete o principal do contrato
// pai, sem representar dinheiro novo saindo do caixa —
// mesma regra já usada em GET /dashboard-emprestimos.
// ====================================================

const CTE_STATUS_PARCELAS = `
    pagamento_status AS (
        SELECT
            p.id AS pagamento_id,
            p.emprestimo_id,
            p.vencimento,
            p.valor,
            COALESCE(
                SUM(
                    CASE
                        WHEN COALESCE(r.tipo, 'Parcela') = 'Parcela'
                        THEN r.valor_recebido + COALESCE(r.desconto, 0)
                        ELSE 0
                    END
                ),
                0
            ) AS total_aplicado
        FROM pagamentos p
        LEFT JOIN recebimentos_parcelas r
            ON r.pagamento_id = p.id
        GROUP BY p.id
    ),
    contrato_parcelas AS (
        SELECT
            emprestimo_id,
            COUNT(*) AS parcelas_totais,
            SUM(CASE WHEN total_aplicado >= valor - 0.009 THEN 1 ELSE 0 END) AS parcelas_pagas,
            SUM(CASE WHEN vencimento < ? AND total_aplicado < valor - 0.009 THEN 1 ELSE 0 END) AS parcelas_vencidas,
            SUM(CASE WHEN vencimento < ? AND total_aplicado < valor - 0.009 THEN (valor - total_aplicado) ELSE 0 END) AS valor_em_atraso,
            MIN(CASE WHEN vencimento < ? AND total_aplicado < valor - 0.009 THEN vencimento END) AS vencimento_mais_antigo_atraso
        FROM pagamento_status
        GROUP BY emprestimo_id
    )
`;

const VALOR_A_RECEBER_SQL = `
    MAX(
        0,
        COALESCE((SELECT SUM(p.valor) FROM pagamentos p WHERE p.emprestimo_id = e.id AND p.status = 'Pendente'), 0)
        - COALESCE((SELECT SUM(m.valor) FROM movimentacoes m WHERE m.emprestimo_id = e.id AND m.tipo = 'Amortização'), 0)
    )
`;

function obterHojeISO() {
    return new Date().toISOString().split("T")[0];
}

function montarFiltrosContrato(query, alias) {
    const clausulas = [];
    const params = [];

    if (query.cliente) {
        clausulas.push(`${alias}.cliente = ?`);
        params.push(query.cliente);
    }

    if (query.tipo) {
        clausulas.push(`${alias}.tipo_emprestimo = ?`);
        params.push(query.tipo);
    }

    if (query.status) {
        clausulas.push(`${alias}.status = ?`);
        params.push(query.status);
    }

    return { clausulas, params };
}

// ====================================
// EXTRATO MENSAL — CARDS POR MÊS
// ====================================

app.get("/extrato-mensal/resumo", async (req, res) => {

    const hoje = obterHojeISO();
    const { clausulas, params } = montarFiltrosContrato(req.query, "e");
    const sufixoFiltros = clausulas.map(c => ` AND ${c}`).join("");

    try {
        const linhasContratos = await dbAll(
            `
            WITH ${CTE_STATUS_PARCELAS}
            SELECT
                strftime('%Y-%m', e.dataEmprestimo) AS competencia,
                COUNT(*) AS quantidade_contratos,
                SUM(CASE WHEN e.emprestimo_origem_id IS NULL THEN e.valor ELSE 0 END) AS valor_emprestado,
                SUM(${VALOR_A_RECEBER_SQL}) AS saldo_atual_carteira,
                SUM(CASE WHEN e.status = 'Ativo' AND COALESCE(cp.parcelas_vencidas, 0) > 0 THEN 1 ELSE 0 END) AS contratos_inadimplentes
            FROM emprestimos e
            LEFT JOIN contrato_parcelas cp ON cp.emprestimo_id = e.id
            WHERE e.dataEmprestimo IS NOT NULL${sufixoFiltros}
            GROUP BY competencia
            `,
            [hoje, hoje, hoje, ...params]
        );

        const linhasRecebimentos = await dbAll(
            `
            SELECT
                strftime('%Y-%m', r.data_recebimento) AS mes,
                COALESCE(SUM(r.valor_recebido), 0) AS total
            FROM recebimentos_parcelas r
            INNER JOIN pagamentos p ON p.id = r.pagamento_id
            INNER JOIN emprestimos e ON e.id = p.emprestimo_id
            WHERE r.data_recebimento IS NOT NULL${sufixoFiltros}
            GROUP BY mes
            `,
            params
        );

        const linhasMovimentacoes = await dbAll(
            `
            SELECT
                strftime('%Y-%m', m.data) AS mes,
                COALESCE(SUM(m.valor), 0) AS total
            FROM movimentacoes m
            INNER JOIN emprestimos e ON e.id = m.emprestimo_id
            WHERE m.tipo IN ('Amortização', 'Quitação', 'Recebimento do Principal', 'Recebimento de Juros')
                AND (m.tipo != 'Recebimento de Juros' OR e.tipo_emprestimo = 'juros_mensal')${sufixoFiltros}
            GROUP BY mes
            `,
            params
        );

        const mapa = {};

        function obterMes(chave) {
            if (!mapa[chave]) {
                mapa[chave] = {
                    competencia: chave,
                    quantidadeContratos: 0,
                    valorEmprestado: 0,
                    valorRecebido: 0,
                    contratosInadimplentes: 0,
                    saldoAtualCarteira: 0
                };
            }
            return mapa[chave];
        }

        linhasContratos.forEach(linha => {
            const item = obterMes(linha.competencia);
            item.quantidadeContratos = Number(linha.quantidade_contratos || 0);
            item.valorEmprestado = Number(linha.valor_emprestado || 0);
            item.saldoAtualCarteira = Number(linha.saldo_atual_carteira || 0);
            item.contratosInadimplentes = Number(linha.contratos_inadimplentes || 0);
        });

        linhasRecebimentos.forEach(linha => {
            obterMes(linha.mes).valorRecebido += Number(linha.total || 0);
        });

        linhasMovimentacoes.forEach(linha => {
            obterMes(linha.mes).valorRecebido += Number(linha.total || 0);
        });

        let meses = Object.values(mapa);

        if (req.query.ano) {
            meses = meses.filter(item => item.competencia.startsWith(`${req.query.ano}-`));
        }

        if (req.query.mes) {
            meses = meses.filter(item => item.competencia.endsWith(`-${req.query.mes}`));
        }

        meses.sort((a, b) => b.competencia.localeCompare(a.competencia));

        res.json({ meses });

    } catch (erro) {
        console.error("Erro ao carregar o resumo do extrato mensal:", erro);
        res.status(500).json({ erro: "Erro ao carregar o resumo do extrato mensal." });
    }

});

// ====================================
// EXTRATO MENSAL — DETALHE DE UM MÊS
// ====================================

app.get("/extrato-mensal/:competencia", async (req, res) => {

    const { competencia } = req.params;

    if (!/^\d{4}-\d{2}$/.test(competencia)) {
        return res.status(400).json({ erro: "Competência inválida. Use o formato AAAA-MM." });
    }

    const hoje = obterHojeISO();
    const { clausulas, params } = montarFiltrosContrato(req.query, "e");
    const sufixoFiltros = clausulas.map(c => ` AND ${c}`).join("");

    const tipoMovimentacaoWhere = `
        m.tipo IN ('Amortização', 'Quitação', 'Recebimento do Principal', 'Recebimento de Juros')
        AND (m.tipo != 'Recebimento de Juros' OR e.tipo_emprestimo = 'juros_mensal')
    `;

    try {
        const idsRelevantes = await dbAll(
            `
            SELECT DISTINCT e.id AS id
            FROM emprestimos e
            WHERE strftime('%Y-%m', e.dataEmprestimo) = ?${sufixoFiltros}

            UNION

            SELECT DISTINCT e.id AS id
            FROM emprestimos e
            INNER JOIN pagamentos p ON p.emprestimo_id = e.id
            INNER JOIN recebimentos_parcelas r ON r.pagamento_id = p.id
            WHERE strftime('%Y-%m', r.data_recebimento) = ?${sufixoFiltros}

            UNION

            SELECT DISTINCT e.id AS id
            FROM emprestimos e
            INNER JOIN movimentacoes m ON m.emprestimo_id = e.id
            WHERE strftime('%Y-%m', m.data) = ?
                AND ${tipoMovimentacaoWhere}${sufixoFiltros}
            `,
            [competencia, ...params, competencia, ...params, competencia, ...params]
        );

        const idsContratos = idsRelevantes.map(linha => linha.id);

        let contratos = [];

        if (idsContratos.length > 0) {
            const marcadores = idsContratos.map(() => "?").join(",");

            contratos = await dbAll(
                `
                WITH ${CTE_STATUS_PARCELAS}
                SELECT
                    e.*,
                    COALESCE(cp.parcelas_totais, 0) AS parcelas_totais,
                    COALESCE(cp.parcelas_pagas, 0) AS parcelas_pagas,
                    COALESCE(cp.parcelas_vencidas, 0) AS parcelas_vencidas,
                    COALESCE(cp.valor_em_atraso, 0) AS valor_em_atraso,
                    cp.vencimento_mais_antigo_atraso,
                    ${VALOR_A_RECEBER_SQL} AS valor_a_receber,
                    (
                        COALESCE(
                            (
                                SELECT SUM(r.valor_recebido)
                                FROM recebimentos_parcelas r
                                INNER JOIN pagamentos p2 ON p2.id = r.pagamento_id
                                WHERE p2.emprestimo_id = e.id
                                    AND strftime('%Y-%m', r.data_recebimento) = ?
                            ),
                            0
                        )
                        +
                        COALESCE(
                            (
                                SELECT SUM(m.valor)
                                FROM movimentacoes m
                                WHERE m.emprestimo_id = e.id
                                    AND strftime('%Y-%m', m.data) = ?
                                    AND ${tipoMovimentacaoWhere}
                            ),
                            0
                        )
                    ) AS total_recebido_no_mes
                FROM emprestimos e
                LEFT JOIN contrato_parcelas cp ON cp.emprestimo_id = e.id
                WHERE e.id IN (${marcadores})
                ORDER BY e.contrato
                `,
                [hoje, hoje, hoje, competencia, competencia, ...idsContratos]
            );
        }

        const linhas = contratos.map(contrato => {
            const emAtraso =
                contrato.status === "Ativo" &&
                Number(contrato.parcelas_vencidas || 0) > 0 &&
                contrato.vencimento_mais_antigo_atraso;

            const diasEmAtraso = emAtraso
                ? Math.max(
                    0,
                    Math.round(
                        (new Date(hoje) - new Date(contrato.vencimento_mais_antigo_atraso)) /
                        (1000 * 60 * 60 * 24)
                    )
                )
                : 0;

            return {
                ...contrato,
                valor: Number(contrato.valor || 0),
                valor_a_receber: Number(contrato.valor_a_receber || 0),
                total_recebido_no_mes: Number(contrato.total_recebido_no_mes || 0),
                parcelas_totais: Number(contrato.parcelas_totais || 0),
                parcelas_pagas: Number(contrato.parcelas_pagas || 0),
                parcelas_restantes: Math.max(0, Number(contrato.parcelas_totais || 0) - Number(contrato.parcelas_pagas || 0)),
                dias_em_atraso: diasEmAtraso
            };
        });

        const carteira = await dbGet(
            `
            WITH ${CTE_STATUS_PARCELAS}
            SELECT
                COUNT(*) AS criados,
                SUM(CASE WHEN e.status = 'Ativo' THEN 1 ELSE 0 END) AS ativos,
                SUM(CASE WHEN e.status = 'Quitado' THEN 1 ELSE 0 END) AS quitados,
                SUM(CASE WHEN e.status = 'Renegociado' THEN 1 ELSE 0 END) AS renegociados,
                SUM(CASE WHEN e.status = 'Ativo' AND COALESCE(cp.parcelas_vencidas, 0) > 0 THEN 1 ELSE 0 END) AS em_atraso,
                SUM(CASE WHEN e.emprestimo_origem_id IS NULL THEN e.valor ELSE 0 END) AS valor_emprestado_raiz,
                SUM(CASE WHEN e.emprestimo_origem_id IS NULL THEN 1 ELSE 0 END) AS quantidade_raiz,
                SUM(e.valor) AS valor_emprestado_total,
                SUM(${VALOR_A_RECEBER_SQL}) AS saldo_atual_carteira,
                COALESCE(SUM(cp.valor_em_atraso), 0) AS valor_total_em_atraso,
                COALESCE(SUM(cp.parcelas_vencidas), 0) AS parcelas_vencidas_total
            FROM emprestimos e
            LEFT JOIN contrato_parcelas cp ON cp.emprestimo_id = e.id
            WHERE strftime('%Y-%m', e.dataEmprestimo) = ?${sufixoFiltros}
            `,
            [hoje, hoje, hoje, competencia, ...params]
        );

        const eventosRecebimentos = await dbGet(
            `
            SELECT
                COALESCE(SUM(CASE WHEN COALESCE(r.tipo, 'Parcela') = 'Parcela' THEN r.valor_recebido ELSE 0 END), 0) AS recebido_parcela,
                COALESCE(SUM(CASE WHEN r.tipo = 'Juros' THEN r.valor_recebido ELSE 0 END), 0) AS recebido_juros,
                COUNT(CASE WHEN COALESCE(r.tipo, 'Parcela') = 'Parcela' THEN 1 END) AS quantidade_parcelas_recebidas
            FROM recebimentos_parcelas r
            INNER JOIN pagamentos p ON p.id = r.pagamento_id
            INNER JOIN emprestimos e ON e.id = p.emprestimo_id
            WHERE strftime('%Y-%m', r.data_recebimento) = ?${sufixoFiltros}
            `,
            [competencia, ...params]
        );

        const eventosMovimentacoes = await dbGet(
            `
            SELECT
                COALESCE(SUM(CASE WHEN m.tipo IN ('Amortização', 'Quitação', 'Recebimento do Principal') THEN m.valor ELSE 0 END), 0) AS recebido_principal_especial,
                COALESCE(SUM(CASE WHEN m.tipo = 'Recebimento de Juros' AND e.tipo_emprestimo = 'juros_mensal' THEN m.valor ELSE 0 END), 0) AS recebido_juros_mensal
            FROM movimentacoes m
            INNER JOIN emprestimos e ON e.id = m.emprestimo_id
            WHERE strftime('%Y-%m', m.data) = ?
                AND ${tipoMovimentacaoWhere}${sufixoFiltros}
            `,
            [competencia, ...params]
        );

        const criados = Number(carteira?.criados || 0);
        const quantidadeRaiz = Number(carteira?.quantidade_raiz || 0);
        const valorEmprestadoRaiz = Number(carteira?.valor_emprestado_raiz || 0);
        const valorEmprestadoTotal = Number(carteira?.valor_emprestado_total || 0);
        const saldoAtualCarteira = Number(carteira?.saldo_atual_carteira || 0);
        const valorTotalEmAtraso = Number(carteira?.valor_total_em_atraso || 0);

        const jurosRecebidos =
            Number(eventosRecebimentos?.recebido_juros || 0) +
            Number(eventosMovimentacoes?.recebido_juros_mensal || 0);

        const principalRecebido = Number(eventosMovimentacoes?.recebido_principal_especial || 0);

        const totalRecebido =
            Number(eventosRecebimentos?.recebido_parcela || 0) +
            jurosRecebidos +
            principalRecebido;

        res.json({
            competencia,
            carteira: {
                criados,
                ativos: Number(carteira?.ativos || 0),
                quitados: Number(carteira?.quitados || 0),
                renegociados: Number(carteira?.renegociados || 0),
                emAtraso: Number(carteira?.em_atraso || 0)
            },
            financeiro: {
                valorEmprestado: valorEmprestadoRaiz,
                totalRecebido,
                principalRecebido,
                jurosRecebidos,
                saldoAtualCarteira,
                lucroDoMes: jurosRecebidos,
                valorMedioPorContrato: criados > 0 ? valorEmprestadoTotal / criados : 0,
                ticketMedio: quantidadeRaiz > 0 ? valorEmprestadoRaiz / quantidadeRaiz : 0,
                parcelasRecebidas: Number(eventosRecebimentos?.quantidade_parcelas_recebidas || 0),
                parcelasVencidas: Number(carteira?.parcelas_vencidas_total || 0),
                valorTotalEmAtraso,
                percentualInadimplencia: saldoAtualCarteira > 0 ? (valorTotalEmAtraso / saldoAtualCarteira) * 100 : 0
            },
            contratos: linhas
        });

    } catch (erro) {
        console.error("Erro ao carregar o detalhe do extrato mensal:", erro);
        res.status(500).json({ erro: "Erro ao carregar o detalhe do extrato mensal." });
    }

});

// ====================================
// CONSULTAR EXTRATO DO CONTRATO
// ====================================

app.get("/emprestimos/:id/extrato", (req, res) => {

    const emprestimoId = req.params.id;

    db.all(
        `
        SELECT
            id,
            emprestimo_id,
            data,
            hora,
            tipo,
            descricao,
            valor,
            saldo
        FROM extrato_contrato
        WHERE emprestimo_id = ?
        ORDER BY data ASC, hora ASC, id ASC
        `,
        [emprestimoId],
        (err, registros) => {

            if (err) {
                console.error("ERRO AO BUSCAR EXTRATO:", err);

                return res.status(500).json({
                    erro: "Não foi possível carregar o extrato.",
                    detalhes: err.message
                });
            }

            return res.json(registros);
        }
    );

});

// ============================================================
// MÓDULO: ANTECIPAÇÃO DE NOTAS FISCAIS
// Rotas novas ficam agrupadas aqui, por etapa, em vez de
// espalhadas entre as rotas de Empréstimos.
// ============================================================

// ==========================
// EMPRESAS CEDENTES — Etapa 1
// ==========================

app.get("/empresas-cedentes", async (req, res) => {
    try {
        const { status, busca } = req.query;

        const clausulas = [];
        const params = [];

        if (status) {
            clausulas.push("status = ?");
            params.push(status);
        }

        if (busca) {
            clausulas.push(
                "(razao_social LIKE ? OR nome_fantasia LIKE ? OR cnpj LIKE ?)"
            );
            const termo = `%${busca}%`;
            params.push(termo, termo, termo);
        }

        const where = clausulas.length
            ? `WHERE ${clausulas.join(" AND ")}`
            : "";

        const linhas = await dbAll(
            `SELECT * FROM empresas_cedentes ${where} ORDER BY razao_social ASC`,
            params
        );

        res.json(linhas);
    } catch (erro) {
        console.error("Erro ao listar empresas cedentes:", erro);
        res.status(500).json({
            erro: "Erro ao listar as empresas cedentes."
        });
    }
});

app.get("/empresas-cedentes/:id", async (req, res) => {
    try {
        const empresa = await dbGet(
            "SELECT * FROM empresas_cedentes WHERE id = ?",
            [req.params.id]
        );

        if (!empresa) {
            return res.status(404).json({
                erro: "Empresa cedente não encontrada."
            });
        }

        res.json(empresa);
    } catch (erro) {
        console.error("Erro ao buscar empresa cedente:", erro);
        res.status(500).json({
            erro: "Erro ao buscar a empresa cedente."
        });
    }
});

app.post("/empresas-cedentes", async (req, res) => {
    const {
        razao_social,
        nome_fantasia,
        cnpj,
        inscricao_estadual,
        contato_nome,
        contato_telefone,
        contato_email,
        endereco,
        banco,
        agencia,
        conta,
        tipo_conta,
        pix,
        limite_credito,
        taxa_padrao,
        status,
        observacoes
    } = req.body;

    if (!razao_social || !razao_social.trim()) {
        return res.status(400).json({
            erro: "Informe a razão social da empresa cedente."
        });
    }

    const cnpjDigitos = apenasDigitos(cnpj);

    if (cnpjDigitos.length !== 14) {
        return res.status(400).json({
            erro: "Informe um CNPJ válido (14 dígitos)."
        });
    }

    try {
        const existentes = await dbAll(
            "SELECT id, cnpj FROM empresas_cedentes",
            []
        );

        const duplicada = existentes.find(
            (empresa) => apenasDigitos(empresa.cnpj) === cnpjDigitos
        );

        if (duplicada) {
            return res.status(409).json({
                erro: "Já existe uma empresa cedente cadastrada com este CNPJ."
            });
        }

        const agora = obterDataHoraCriacaoBrasilia();

        const resultado = await dbRun(
            `
            INSERT INTO empresas_cedentes (
                razao_social, nome_fantasia, cnpj, inscricao_estadual,
                contato_nome, contato_telefone, contato_email, endereco,
                banco, agencia, conta, tipo_conta, pix,
                limite_credito, taxa_padrao, status, observacoes,
                criado_em, atualizado_em
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                razao_social.trim(),
                nome_fantasia || null,
                cnpj,
                inscricao_estadual || null,
                contato_nome || null,
                contato_telefone || null,
                contato_email || null,
                endereco || null,
                banco || null,
                agencia || null,
                conta || null,
                tipo_conta || null,
                pix || null,
                Number(limite_credito) || 0,
                taxa_padrao !== undefined && taxa_padrao !== null && taxa_padrao !== ""
                    ? Number(taxa_padrao)
                    : null,
                status || "Ativa",
                observacoes || null,
                agora,
                agora
            ]
        );

        res.json({
            id: resultado.lastID,
            mensagem: "Empresa cedente cadastrada com sucesso!"
        });
    } catch (erro) {
        console.error("Erro ao cadastrar empresa cedente:", erro);

        if (String(erro.message || "").includes("UNIQUE")) {
            return res.status(409).json({
                erro: "Já existe uma empresa cedente cadastrada com este CNPJ."
            });
        }

        res.status(500).json({
            erro: "Erro ao cadastrar a empresa cedente."
        });
    }
});

app.put("/empresas-cedentes/:id", async (req, res) => {
    const { id } = req.params;

    const {
        razao_social,
        nome_fantasia,
        cnpj,
        inscricao_estadual,
        contato_nome,
        contato_telefone,
        contato_email,
        endereco,
        banco,
        agencia,
        conta,
        tipo_conta,
        pix,
        limite_credito,
        taxa_padrao,
        status,
        observacoes
    } = req.body;

    if (!razao_social || !razao_social.trim()) {
        return res.status(400).json({
            erro: "Informe a razão social da empresa cedente."
        });
    }

    const cnpjDigitos = apenasDigitos(cnpj);

    if (cnpjDigitos.length !== 14) {
        return res.status(400).json({
            erro: "Informe um CNPJ válido (14 dígitos)."
        });
    }

    try {
        const atual = await dbGet(
            "SELECT id FROM empresas_cedentes WHERE id = ?",
            [id]
        );

        if (!atual) {
            return res.status(404).json({
                erro: "Empresa cedente não encontrada."
            });
        }

        const existentes = await dbAll(
            "SELECT id, cnpj FROM empresas_cedentes WHERE id != ?",
            [id]
        );

        const duplicada = existentes.find(
            (empresa) => apenasDigitos(empresa.cnpj) === cnpjDigitos
        );

        if (duplicada) {
            return res.status(409).json({
                erro: "Já existe uma empresa cedente cadastrada com este CNPJ."
            });
        }

        await dbRun(
            `
            UPDATE empresas_cedentes
            SET
                razao_social = ?,
                nome_fantasia = ?,
                cnpj = ?,
                inscricao_estadual = ?,
                contato_nome = ?,
                contato_telefone = ?,
                contato_email = ?,
                endereco = ?,
                banco = ?,
                agencia = ?,
                conta = ?,
                tipo_conta = ?,
                pix = ?,
                limite_credito = ?,
                taxa_padrao = ?,
                status = ?,
                observacoes = ?,
                atualizado_em = ?
            WHERE id = ?
            `,
            [
                razao_social.trim(),
                nome_fantasia || null,
                cnpj,
                inscricao_estadual || null,
                contato_nome || null,
                contato_telefone || null,
                contato_email || null,
                endereco || null,
                banco || null,
                agencia || null,
                conta || null,
                tipo_conta || null,
                pix || null,
                Number(limite_credito) || 0,
                taxa_padrao !== undefined && taxa_padrao !== null && taxa_padrao !== ""
                    ? Number(taxa_padrao)
                    : null,
                status || "Ativa",
                observacoes || null,
                obterDataHoraCriacaoBrasilia(),
                id
            ]
        );

        res.json({
            mensagem: "Empresa cedente atualizada com sucesso!"
        });
    } catch (erro) {
        console.error("Erro ao atualizar empresa cedente:", erro);

        if (String(erro.message || "").includes("UNIQUE")) {
            return res.status(409).json({
                erro: "Já existe uma empresa cedente cadastrada com este CNPJ."
            });
        }

        res.status(500).json({
            erro: "Erro ao atualizar a empresa cedente."
        });
    }
});

app.delete("/empresas-cedentes/:id", async (req, res) => {
    try {
        const atual = await dbGet(
            "SELECT id FROM empresas_cedentes WHERE id = ?",
            [req.params.id]
        );

        if (!atual) {
            return res.status(404).json({
                erro: "Empresa cedente não encontrada."
            });
        }

        // Operações referenciam a empresa via INNER JOIN (não LEFT JOIN) —
        // excluir uma empresa com operações vinculadas as tornaria
        // inacessíveis (404 em GET /operacoes-antecipacao/:id e somem da
        // listagem), mesmo com todo o histórico de NFs/recebimentos/
        // comissões/custos ainda no banco, órfão e sem rota de recuperação.
        const operacaoVinculada = await dbGet(
            "SELECT id FROM operacoes_antecipacao WHERE empresa_cedente_id = ? LIMIT 1",
            [req.params.id]
        );

        if (operacaoVinculada) {
            return res.status(400).json({
                erro: "Esta empresa cedente possui operações vinculadas e não pode ser excluída — esse é o histórico real das operações."
            });
        }

        await dbRun(
            "DELETE FROM empresas_cedentes WHERE id = ?",
            [req.params.id]
        );

        res.json({
            mensagem: "Empresa cedente excluída com sucesso!"
        });
    } catch (erro) {
        console.error("Erro ao excluir empresa cedente:", erro);
        res.status(500).json({
            erro: "Erro ao excluir a empresa cedente."
        });
    }
});

// ==========================
// SACADOS — Etapa 2
// ==========================

app.get("/sacados", async (req, res) => {
    try {
        const { busca } = req.query;

        const clausulas = [];
        const params = [];

        if (busca) {
            clausulas.push("(nome LIKE ? OR cnpj_cpf LIKE ?)");
            const termo = `%${busca}%`;
            params.push(termo, termo);
        }

        const where = clausulas.length
            ? `WHERE ${clausulas.join(" AND ")}`
            : "";

        const linhas = await dbAll(
            `SELECT * FROM sacados ${where} ORDER BY nome ASC`,
            params
        );

        res.json(linhas);
    } catch (erro) {
        console.error("Erro ao listar sacados:", erro);
        res.status(500).json({
            erro: "Erro ao listar os sacados."
        });
    }
});

app.get("/sacados/:id", async (req, res) => {
    try {
        const sacado = await dbGet(
            "SELECT * FROM sacados WHERE id = ?",
            [req.params.id]
        );

        if (!sacado) {
            return res.status(404).json({
                erro: "Sacado não encontrado."
            });
        }

        res.json(sacado);
    } catch (erro) {
        console.error("Erro ao buscar sacado:", erro);
        res.status(500).json({
            erro: "Erro ao buscar o sacado."
        });
    }
});

app.post("/sacados", async (req, res) => {
    const {
        nome,
        cnpj_cpf,
        contato_telefone,
        contato_email,
        limite_credito,
        status,
        observacoes
    } = req.body;

    if (!nome || !nome.trim()) {
        return res.status(400).json({
            erro: "Informe o nome do sacado."
        });
    }

    const documentoDigitos = apenasDigitos(cnpj_cpf);

    if (documentoDigitos.length !== 11 && documentoDigitos.length !== 14) {
        return res.status(400).json({
            erro: "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido."
        });
    }

    try {
        const existentes = await dbAll(
            "SELECT id, cnpj_cpf FROM sacados",
            []
        );

        const duplicado = existentes.find(
            (sacado) => apenasDigitos(sacado.cnpj_cpf) === documentoDigitos
        );

        if (duplicado) {
            return res.status(409).json({
                erro: "Já existe um sacado cadastrado com este CPF/CNPJ."
            });
        }

        const agora = obterDataHoraCriacaoBrasilia();

        const resultado = await dbRun(
            `
            INSERT INTO sacados (
                nome, cnpj_cpf, contato_telefone, contato_email,
                limite_credito, status, observacoes, criado_em, atualizado_em
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                nome.trim(),
                cnpj_cpf,
                contato_telefone || null,
                contato_email || null,
                Number(limite_credito) || 0,
                status || "Ativa",
                observacoes || null,
                agora,
                agora
            ]
        );

        res.json({
            id: resultado.lastID,
            mensagem: "Sacado cadastrado com sucesso!"
        });
    } catch (erro) {
        console.error("Erro ao cadastrar sacado:", erro);

        if (String(erro.message || "").includes("UNIQUE")) {
            return res.status(409).json({
                erro: "Já existe um sacado cadastrado com este CPF/CNPJ."
            });
        }

        res.status(500).json({
            erro: "Erro ao cadastrar o sacado."
        });
    }
});

app.put("/sacados/:id", async (req, res) => {
    const { id } = req.params;
    const {
        nome,
        cnpj_cpf,
        contato_telefone,
        contato_email,
        limite_credito,
        status,
        observacoes
    } = req.body;

    if (!nome || !nome.trim()) {
        return res.status(400).json({
            erro: "Informe o nome do sacado."
        });
    }

    const documentoDigitos = apenasDigitos(cnpj_cpf);

    if (documentoDigitos.length !== 11 && documentoDigitos.length !== 14) {
        return res.status(400).json({
            erro: "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido."
        });
    }

    try {
        const atual = await dbGet(
            "SELECT id FROM sacados WHERE id = ?",
            [id]
        );

        if (!atual) {
            return res.status(404).json({
                erro: "Sacado não encontrado."
            });
        }

        const existentes = await dbAll(
            "SELECT id, cnpj_cpf FROM sacados WHERE id != ?",
            [id]
        );

        const duplicado = existentes.find(
            (sacado) => apenasDigitos(sacado.cnpj_cpf) === documentoDigitos
        );

        if (duplicado) {
            return res.status(409).json({
                erro: "Já existe um sacado cadastrado com este CPF/CNPJ."
            });
        }

        await dbRun(
            `
            UPDATE sacados
            SET
                nome = ?,
                cnpj_cpf = ?,
                contato_telefone = ?,
                contato_email = ?,
                limite_credito = ?,
                status = ?,
                observacoes = ?,
                atualizado_em = ?
            WHERE id = ?
            `,
            [
                nome.trim(),
                cnpj_cpf,
                contato_telefone || null,
                contato_email || null,
                Number(limite_credito) || 0,
                status || "Ativa",
                observacoes || null,
                obterDataHoraCriacaoBrasilia(),
                id
            ]
        );

        res.json({
            mensagem: "Sacado atualizado com sucesso!"
        });
    } catch (erro) {
        console.error("Erro ao atualizar sacado:", erro);

        if (String(erro.message || "").includes("UNIQUE")) {
            return res.status(409).json({
                erro: "Já existe um sacado cadastrado com este CPF/CNPJ."
            });
        }

        res.status(500).json({
            erro: "Erro ao atualizar o sacado."
        });
    }
});

app.delete("/sacados/:id", async (req, res) => {
    try {
        const atual = await dbGet(
            "SELECT id FROM sacados WHERE id = ?",
            [req.params.id]
        );

        if (!atual) {
            return res.status(404).json({
                erro: "Sacado não encontrado."
            });
        }

        // Mesma classe de bug corrigida em DELETE /empresas-cedentes/:id:
        // notas_fiscais usa INNER JOIN com sacados (SELECT_NOTA_FISCAL) —
        // excluir um sacado com NF vinculada tornaria essa NF inacessível
        // (404 em GET /notas-fiscais/:id, some da listagem), mesmo com todo
        // o histórico de recebimentos ainda no banco, órfão.
        const notaVinculada = await dbGet(
            "SELECT id FROM notas_fiscais WHERE sacado_id = ? LIMIT 1",
            [req.params.id]
        );

        if (notaVinculada) {
            return res.status(400).json({
                erro: "Este sacado possui notas fiscais vinculadas e não pode ser excluído — esse é o histórico real das operações."
            });
        }

        await dbRun(
            "DELETE FROM sacados WHERE id = ?",
            [req.params.id]
        );

        res.json({
            mensagem: "Sacado excluído com sucesso!"
        });
    } catch (erro) {
        console.error("Erro ao excluir sacado:", erro);
        res.status(500).json({
            erro: "Erro ao excluir o sacado."
        });
    }
});

// ==========================
// COMISSIONADOS — Etapa 3
// ==========================

const TIPOS_COMISSIONADO = ["Interno", "Parceiro"];

app.get("/comissionados", async (req, res) => {
    try {
        const { busca, status } = req.query;

        const clausulas = [];
        const params = [];

        if (busca) {
            clausulas.push("(nome LIKE ? OR cpf_cnpj LIKE ?)");
            const termo = `%${busca}%`;
            params.push(termo, termo);
        }

        if (status) {
            clausulas.push("status = ?");
            params.push(status);
        }

        const where = clausulas.length
            ? `WHERE ${clausulas.join(" AND ")}`
            : "";

        const linhas = await dbAll(
            `SELECT * FROM comissionados ${where} ORDER BY nome ASC`,
            params
        );

        res.json(linhas);
    } catch (erro) {
        console.error("Erro ao listar comissionados:", erro);
        res.status(500).json({
            erro: "Erro ao listar os comissionados."
        });
    }
});

app.get("/comissionados/:id", async (req, res) => {
    try {
        const comissionado = await dbGet(
            "SELECT * FROM comissionados WHERE id = ?",
            [req.params.id]
        );

        if (!comissionado) {
            return res.status(404).json({
                erro: "Comissionado não encontrado."
            });
        }

        res.json(comissionado);
    } catch (erro) {
        console.error("Erro ao buscar comissionado:", erro);
        res.status(500).json({
            erro: "Erro ao buscar o comissionado."
        });
    }
});

app.post("/comissionados", async (req, res) => {
    const {
        nome,
        cpf_cnpj,
        tipo,
        contato_telefone,
        contato_email,
        banco,
        agencia,
        conta,
        pix,
        status,
        observacoes
    } = req.body;

    if (!nome || !nome.trim()) {
        return res.status(400).json({
            erro: "Informe o nome do comissionado."
        });
    }

    const documentoDigitos = apenasDigitos(cpf_cnpj);

    if (documentoDigitos.length !== 11 && documentoDigitos.length !== 14) {
        return res.status(400).json({
            erro: "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido."
        });
    }

    const tipoFinal = tipo || "Interno";

    if (!TIPOS_COMISSIONADO.includes(tipoFinal)) {
        return res.status(400).json({
            erro: `Tipo inválido. Use um de: ${TIPOS_COMISSIONADO.join(", ")}.`
        });
    }

    try {
        const existentes = await dbAll(
            "SELECT id, cpf_cnpj FROM comissionados",
            []
        );

        const duplicado = existentes.find(
            (item) => apenasDigitos(item.cpf_cnpj) === documentoDigitos
        );

        if (duplicado) {
            return res.status(409).json({
                erro: "Já existe um comissionado cadastrado com este CPF/CNPJ."
            });
        }

        const agora = obterDataHoraCriacaoBrasilia();

        const resultado = await dbRun(
            `
            INSERT INTO comissionados (
                nome, cpf_cnpj, tipo, contato_telefone, contato_email,
                banco, agencia, conta, pix, status, observacoes,
                criado_em, atualizado_em
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                nome.trim(),
                cpf_cnpj,
                tipoFinal,
                contato_telefone || null,
                contato_email || null,
                banco || null,
                agencia || null,
                conta || null,
                pix || null,
                status || "Ativo",
                observacoes || null,
                agora,
                agora
            ]
        );

        res.json({
            id: resultado.lastID,
            mensagem: "Comissionado cadastrado com sucesso!"
        });
    } catch (erro) {
        console.error("Erro ao cadastrar comissionado:", erro);

        if (String(erro.message || "").includes("UNIQUE")) {
            return res.status(409).json({
                erro: "Já existe um comissionado cadastrado com este CPF/CNPJ."
            });
        }

        res.status(500).json({
            erro: "Erro ao cadastrar o comissionado."
        });
    }
});

app.put("/comissionados/:id", async (req, res) => {
    const { id } = req.params;
    const {
        nome,
        cpf_cnpj,
        tipo,
        contato_telefone,
        contato_email,
        banco,
        agencia,
        conta,
        pix,
        status,
        observacoes
    } = req.body;

    if (!nome || !nome.trim()) {
        return res.status(400).json({
            erro: "Informe o nome do comissionado."
        });
    }

    const documentoDigitos = apenasDigitos(cpf_cnpj);

    if (documentoDigitos.length !== 11 && documentoDigitos.length !== 14) {
        return res.status(400).json({
            erro: "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido."
        });
    }

    const tipoFinal = tipo || "Interno";

    if (!TIPOS_COMISSIONADO.includes(tipoFinal)) {
        return res.status(400).json({
            erro: `Tipo inválido. Use um de: ${TIPOS_COMISSIONADO.join(", ")}.`
        });
    }

    try {
        const atual = await dbGet(
            "SELECT id FROM comissionados WHERE id = ?",
            [id]
        );

        if (!atual) {
            return res.status(404).json({
                erro: "Comissionado não encontrado."
            });
        }

        const existentes = await dbAll(
            "SELECT id, cpf_cnpj FROM comissionados WHERE id != ?",
            [id]
        );

        const duplicado = existentes.find(
            (item) => apenasDigitos(item.cpf_cnpj) === documentoDigitos
        );

        if (duplicado) {
            return res.status(409).json({
                erro: "Já existe um comissionado cadastrado com este CPF/CNPJ."
            });
        }

        await dbRun(
            `
            UPDATE comissionados
            SET
                nome = ?,
                cpf_cnpj = ?,
                tipo = ?,
                contato_telefone = ?,
                contato_email = ?,
                banco = ?,
                agencia = ?,
                conta = ?,
                pix = ?,
                status = ?,
                observacoes = ?,
                atualizado_em = ?
            WHERE id = ?
            `,
            [
                nome.trim(),
                cpf_cnpj,
                tipoFinal,
                contato_telefone || null,
                contato_email || null,
                banco || null,
                agencia || null,
                conta || null,
                pix || null,
                status || "Ativo",
                observacoes || null,
                obterDataHoraCriacaoBrasilia(),
                id
            ]
        );

        res.json({
            mensagem: "Comissionado atualizado com sucesso!"
        });
    } catch (erro) {
        console.error("Erro ao atualizar comissionado:", erro);

        if (String(erro.message || "").includes("UNIQUE")) {
            return res.status(409).json({
                erro: "Já existe um comissionado cadastrado com este CPF/CNPJ."
            });
        }

        res.status(500).json({
            erro: "Erro ao atualizar o comissionado."
        });
    }
});

app.delete("/comissionados/:id", async (req, res) => {
    try {
        const atual = await dbGet(
            "SELECT id FROM comissionados WHERE id = ?",
            [req.params.id]
        );

        if (!atual) {
            return res.status(404).json({
                erro: "Comissionado não encontrado."
            });
        }

        await dbRun(
            "DELETE FROM comissionados WHERE id = ?",
            [req.params.id]
        );

        res.json({
            mensagem: "Comissionado excluído com sucesso!"
        });
    } catch (erro) {
        console.error("Erro ao excluir comissionado:", erro);
        res.status(500).json({
            erro: "Erro ao excluir o comissionado."
        });
    }
});

// ==========================
// OPERAÇÕES DE ANTECIPAÇÃO — Etapa 4
// ==========================
// Ainda sem notas fiscais (Etapa 5) — por isso as rotas abaixo não
// calculam valor_face/deságio/valor líquido ainda. Isso entra quando
// notas_fiscais existir, sem precisar mudar o formato da tabela.

const STATUS_OPERACAO_NF = [
    "Aprovada",
    "Ativa",
    "Concluída",
    "Cancelada"
];

const MODALIDADES_TAXA_NF = ["mensal", "fixa_operacao"];

// Mesmo prefixo AX-2026-NNNNNN do módulo de Empréstimos, com "NF" para
// diferenciar o módulo à primeira vista (AX-NF-2026-000001).
app.get("/proximo-numero-operacao", async (req, res) => {
    try {
        const ultima = await dbGet(
            `SELECT numero_operacao
             FROM operacoes_antecipacao
             ORDER BY id DESC
             LIMIT 1`,
            []
        );

        let numero = 1;

        if (ultima && ultima.numero_operacao) {
            const partes = ultima.numero_operacao.split("-");
            const sequencial = parseInt(partes[3], 10);

            if (Number.isFinite(sequencial)) {
                numero = sequencial + 1;
            }
        }

        const numeroOperacao = `AX-NF-2026-${String(numero).padStart(6, "0")}`;

        res.json({ numero_operacao: numeroOperacao });
    } catch (erro) {
        console.error("Erro ao gerar número da operação:", erro);
        res.status(500).json({
            erro: "Erro ao gerar o número da operação."
        });
    }
});

// saldo_a_receber da operação é sempre valor_face - total_aplicado,
// recalculado na leitura a partir das próprias NFs — nunca uma coluna
// própria, para nunca dessincronizar do que as NFs realmente mostram.
// Deságio (lucro bruto) nunca é afetado por comissão/custo — é só
// valor_face x taxa x prazo. Lucro líquido é o único que muda, e só
// quando a comissão é efetivamente PAGA (regime de caixa: uma comissão
// Pendente/Aprovada ainda não pagou, então ainda não afetou o resultado
// líquido de verdade). Custos (Etapa 8) ainda não existem — o campo já
// existe aqui zerado, para a Etapa 8 só precisar somar a subconsulta
// real, sem redesenhar a fórmula.
function comSaldoOperacao(operacao) {
    const valorFace = Number(operacao.valor_face || 0);
    const totalAplicado = Number(operacao.total_aplicado || 0);
    const prazoMedio = Number(operacao.prazo_medio_ponderado || 0);
    const taxa = Number(operacao.taxa || 0);

    const desagio =
        operacao.modalidade_taxa === "fixa_operacao"
            ? valorFace * (taxa / 100)
            : valorFace * (taxa / 100) * (prazoMedio / 30);

    const totalComissoesPagas = Number(operacao.total_comissoes_pagas || 0);

    // Só custo PAGO afeta valor realizado — Pendente/Aprovado aparecem
    // como "previsto" (total_custos_previstos), sem entrar aqui. E só o
    // responsável decide ONDE o custo pago desconta: Cedente tira do
    // repasse, AX Holding tira do lucro líquido — nunca do lucro bruto.
    const totalCustosCedentePagos = Number(operacao.total_custos_cedente_pagos || 0);
    const totalCustosAxPagos = Number(operacao.total_custos_ax_pagos || 0);
    const totalCustosPagos = totalCustosCedentePagos + totalCustosAxPagos;
    const totalCustosPrevistos = Number(operacao.total_custos_previstos || 0);

    const valorLiquidoRepasse = Math.max(0, valorFace - desagio - totalCustosCedentePagos);
    const lucroLiquido = desagio - totalComissoesPagas - totalCustosAxPagos;

    return {
        ...operacao,
        valor_face: valorFace,
        total_aplicado: totalAplicado,
        total_recebido: Number(operacao.total_recebido || 0),
        total_juros_recebidos: Number(operacao.total_juros_recebidos || 0),
        total_multas_recebidas: Number(operacao.total_multas_recebidas || 0),
        saldo_a_receber: Math.max(0, valorFace - totalAplicado),
        prazo_medio_ponderado: prazoMedio,
        total_comissoes: Number(operacao.total_comissoes || 0),
        total_comissoes_pagas: totalComissoesPagas,
        total_custos_cedente_pagos: totalCustosCedentePagos,
        total_custos_ax_pagos: totalCustosAxPagos,
        total_custos_pagos: totalCustosPagos,
        total_custos_previstos: totalCustosPrevistos,
        valor_liquido_repasse: valorLiquidoRepasse,
        lucro_bruto: desagio,
        lucro_liquido: lucroLiquido
    };
}

const SUBQUERIES_TOTAIS_OPERACAO = `
    COALESCE((
        SELECT SUM(n.valor)
        FROM notas_fiscais n
        WHERE n.operacao_id = o.id AND n.cancelada = 0
    ), 0) AS valor_face,
    COALESCE((
        SELECT COUNT(*)
        FROM notas_fiscais n
        WHERE n.operacao_id = o.id AND n.cancelada = 0
    ), 0) AS quantidade_notas,
    COALESCE((
        SELECT SUM(CASE WHEN r.tipo = 'Recebimento' THEN r.valor_recebido + r.desconto ELSE 0 END)
        FROM recebimentos_nf r
        INNER JOIN notas_fiscais n ON n.id = r.nota_fiscal_id
        WHERE n.operacao_id = o.id
    ), 0) AS total_aplicado,
    COALESCE((
        SELECT SUM(CASE WHEN r.tipo = 'Recebimento' THEN r.valor_recebido ELSE 0 END)
        FROM recebimentos_nf r
        INNER JOIN notas_fiscais n ON n.id = r.nota_fiscal_id
        WHERE n.operacao_id = o.id
    ), 0) AS total_recebido,
    COALESCE((
        SELECT SUM(CASE WHEN r.tipo = 'Juros' THEN r.valor_recebido ELSE 0 END)
        FROM recebimentos_nf r
        INNER JOIN notas_fiscais n ON n.id = r.nota_fiscal_id
        WHERE n.operacao_id = o.id
    ), 0) AS total_juros_recebidos,
    COALESCE((
        SELECT SUM(CASE WHEN r.tipo = 'Multa' THEN r.valor_recebido ELSE 0 END)
        FROM recebimentos_nf r
        INNER JOIN notas_fiscais n ON n.id = r.nota_fiscal_id
        WHERE n.operacao_id = o.id
    ), 0) AS total_multas_recebidas,
    COALESCE((
        SELECT SUM((julianday(n.data_vencimento) - julianday(o.data_operacao)) * n.valor)
             / NULLIF(SUM(n.valor), 0)
        FROM notas_fiscais n
        WHERE n.operacao_id = o.id AND n.cancelada = 0
    ), 0) AS prazo_medio_ponderado,
    COALESCE((
        SELECT SUM(c.valor_calculado)
        FROM comissoes_operacao c
        WHERE c.operacao_id = o.id AND c.status != 'Cancelada'
    ), 0) AS total_comissoes,
    COALESCE((
        SELECT SUM(c.valor_calculado)
        FROM comissoes_operacao c
        WHERE c.operacao_id = o.id AND c.status = 'Paga'
    ), 0) AS total_comissoes_pagas,
    COALESCE((
        SELECT SUM(cu.valor)
        FROM custos_operacao cu
        WHERE cu.operacao_id = o.id AND cu.responsavel_custo = 'Cedente' AND cu.status = 'Pago'
    ), 0) AS total_custos_cedente_pagos,
    COALESCE((
        SELECT SUM(cu.valor)
        FROM custos_operacao cu
        WHERE cu.operacao_id = o.id AND cu.responsavel_custo = 'AX Holding' AND cu.status = 'Pago'
    ), 0) AS total_custos_ax_pagos,
    COALESCE((
        SELECT SUM(cu.valor)
        FROM custos_operacao cu
        WHERE cu.operacao_id = o.id AND cu.status IN ('Pendente', 'Aprovado')
    ), 0) AS total_custos_previstos
`;

app.get("/operacoes-antecipacao", async (req, res) => {
    try {
        const { status, empresa_cedente_id, busca } = req.query;

        const clausulas = [];
        const params = [];

        if (status) {
            clausulas.push("o.status = ?");
            params.push(status);
        }

        if (empresa_cedente_id) {
            clausulas.push("o.empresa_cedente_id = ?");
            params.push(empresa_cedente_id);
        }

        if (busca) {
            clausulas.push(
                "(o.numero_operacao LIKE ? OR e.razao_social LIKE ? OR e.nome_fantasia LIKE ?)"
            );
            const termo = `%${busca}%`;
            params.push(termo, termo, termo);
        }

        const where = clausulas.length
            ? `WHERE ${clausulas.join(" AND ")}`
            : "";

        const linhas = await dbAll(
            `
            SELECT
                o.*,
                e.razao_social AS empresa_razao_social,
                e.nome_fantasia AS empresa_nome_fantasia,
                e.cnpj AS empresa_cnpj,
                ${SUBQUERIES_TOTAIS_OPERACAO}
            FROM operacoes_antecipacao o
            INNER JOIN empresas_cedentes e ON e.id = o.empresa_cedente_id
            ${where}
            ORDER BY o.id DESC
            `,
            params
        );

        res.json(linhas.map(comSaldoOperacao));
    } catch (erro) {
        console.error("Erro ao listar operações de antecipação:", erro);
        res.status(500).json({
            erro: "Erro ao listar as operações de antecipação."
        });
    }
});

app.get("/operacoes-antecipacao/:id", async (req, res) => {
    try {
        const operacao = await dbGet(
            `
            SELECT
                o.*,
                e.razao_social AS empresa_razao_social,
                e.nome_fantasia AS empresa_nome_fantasia,
                e.cnpj AS empresa_cnpj,
                ${SUBQUERIES_TOTAIS_OPERACAO}
            FROM operacoes_antecipacao o
            INNER JOIN empresas_cedentes e ON e.id = o.empresa_cedente_id
            WHERE o.id = ?
            `,
            [req.params.id]
        );

        if (!operacao) {
            return res.status(404).json({
                erro: "Operação não encontrada."
            });
        }

        res.json(comSaldoOperacao(operacao));
    } catch (erro) {
        console.error("Erro ao buscar operação de antecipação:", erro);
        res.status(500).json({
            erro: "Erro ao buscar a operação de antecipação."
        });
    }
});

app.post("/operacoes-antecipacao", async (req, res) => {
    const {
        numero_operacao,
        empresa_cedente_id,
        data_operacao,
        taxa,
        modalidade_taxa,
        prazo_dias,
        responsavel,
        observacoes
    } = req.body;

    if (!numero_operacao || !numero_operacao.trim()) {
        return res.status(400).json({
            erro: "Número da operação não informado."
        });
    }

    if (!empresa_cedente_id) {
        return res.status(400).json({
            erro: "Selecione a empresa cedente."
        });
    }

    if (!data_operacao) {
        return res.status(400).json({
            erro: "Informe a data da operação."
        });
    }

    const taxaNumero = Number(taxa);

    if (!Number.isFinite(taxaNumero) || taxaNumero <= 0) {
        return res.status(400).json({
            erro: "Informe uma taxa válida, maior que zero."
        });
    }

    const modalidadeFinal = modalidade_taxa || "mensal";

    if (!MODALIDADES_TAXA_NF.includes(modalidadeFinal)) {
        return res.status(400).json({
            erro: `Modalidade de taxa inválida. Use um de: ${MODALIDADES_TAXA_NF.join(", ")}.`
        });
    }

    try {
        const empresa = await dbGet(
            "SELECT id, status, razao_social FROM empresas_cedentes WHERE id = ?",
            [empresa_cedente_id]
        );

        if (!empresa) {
            return res.status(400).json({
                erro: "Empresa cedente não encontrada."
            });
        }

        // Toda operação nova começa em "Aprovada" — já pronta para
        // receber NFs/custos/comissões e seguir para o repasse; o
        // status não é aceito do cliente na criação, só evolui pelas
        // rotas/ações específicas de cada etapa do fluxo (o frontend
        // apresenta este estado como "Ativa (Aguardando Repasse)").
        const agora = obterDataHoraCriacaoBrasilia();

        const resultado = await dbRun(
            `
            INSERT INTO operacoes_antecipacao (
                numero_operacao, empresa_cedente_id, data_operacao,
                taxa, modalidade_taxa, prazo_dias, status, responsavel,
                observacoes, criado_em, atualizado_em
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                numero_operacao.trim(),
                empresa_cedente_id,
                data_operacao,
                taxaNumero,
                modalidadeFinal,
                prazo_dias !== undefined && prazo_dias !== null && prazo_dias !== ""
                    ? Number(prazo_dias)
                    : null,
                "Aprovada",
                responsavel || null,
                observacoes || null,
                agora,
                agora
            ]
        );

        registrarMovimentacaoNF(
            resultado.lastID,
            "Criação",
            `Operação ${numero_operacao.trim()} criada para ${empresa.razao_social}, taxa ${taxaNumero}% (${modalidadeFinal === "fixa_operacao" ? "fixa por operação" : "ao mês"}).`,
            null,
            responsavel || null
        );

        res.json({
            id: resultado.lastID,
            numero_operacao: numero_operacao.trim(),
            mensagem: "Operação de antecipação cadastrada com sucesso!"
        });
    } catch (erro) {
        console.error("Erro ao cadastrar operação de antecipação:", erro);

        if (String(erro.message || "").includes("UNIQUE")) {
            return res.status(409).json({
                erro: "Já existe uma operação cadastrada com este número."
            });
        }

        res.status(500).json({
            erro: "Erro ao cadastrar a operação de antecipação."
        });
    }
});

app.put("/operacoes-antecipacao/:id", async (req, res) => {
    const { id } = req.params;
    const {
        empresa_cedente_id,
        data_operacao,
        taxa,
        modalidade_taxa,
        prazo_dias,
        status,
        responsavel,
        observacoes
    } = req.body;

    try {
        const atual = await dbGet(
            "SELECT * FROM operacoes_antecipacao WHERE id = ?",
            [id]
        );

        if (!atual) {
            return res.status(404).json({
                erro: "Operação não encontrada."
            });
        }

        // Repasse (Etapa 9) é a etapa definitiva do cálculo financeiro:
        // a partir de "Ativa", valor de face, deságio e os termos da
        // operação ficam travados — só observações passam daqui pra
        // frente, mesma disciplina de Concluída/Cancelada. Só NFs podem
        // receber lançamento (recebimentos), por uma rota própria que
        // não passa por aqui.
        if (atual.status === "Ativa" || atual.status === "Concluída" || atual.status === "Cancelada") {
            if (observacoes === undefined) {
                return res.status(400).json({
                    erro: "Nada para atualizar."
                });
            }

            await dbRun(
                `UPDATE operacoes_antecipacao
                 SET observacoes = ?, atualizado_em = ?
                 WHERE id = ?`,
                [observacoes || null, obterDataHoraCriacaoBrasilia(), id]
            );

            return res.json({
                mensagem:
                    "Operações Ativas, Concluídas ou Canceladas têm o cálculo financeiro travado — apenas as observações foram atualizadas."
            });
        }

        if (!empresa_cedente_id) {
            return res.status(400).json({
                erro: "Selecione a empresa cedente."
            });
        }

        if (!data_operacao) {
            return res.status(400).json({
                erro: "Informe a data da operação."
            });
        }

        const taxaNumero = Number(taxa);

        if (!Number.isFinite(taxaNumero) || taxaNumero <= 0) {
            return res.status(400).json({
                erro: "Informe uma taxa válida, maior que zero."
            });
        }

        const modalidadeFinal = modalidade_taxa || "mensal";

        if (!MODALIDADES_TAXA_NF.includes(modalidadeFinal)) {
            return res.status(400).json({
                erro: `Modalidade de taxa inválida. Use um de: ${MODALIDADES_TAXA_NF.join(", ")}.`
            });
        }

        const statusFinal = status || atual.status;

        if (!STATUS_OPERACAO_NF.includes(statusFinal)) {
            return res.status(400).json({
                erro: `Status inválido. Use um de: ${STATUS_OPERACAO_NF.join(", ")}.`
            });
        }

        // "Ativa" só é atingida confirmando o repasse (garante que nunca
        // existe operação Ativa sem um registro de repasse por trás).
        if (statusFinal === "Ativa") {
            return res.status(400).json({
                erro:
                    'Para ativar a operação, confirme o repasse em "POST /operacoes-antecipacao/:id/repasse" — o status não pode ser definido diretamente.'
            });
        }

        const empresa = await dbGet(
            "SELECT id FROM empresas_cedentes WHERE id = ?",
            [empresa_cedente_id]
        );

        if (!empresa) {
            return res.status(400).json({
                erro: "Empresa cedente não encontrada."
            });
        }

        await dbRun(
            `
            UPDATE operacoes_antecipacao
            SET
                empresa_cedente_id = ?,
                data_operacao = ?,
                taxa = ?,
                modalidade_taxa = ?,
                prazo_dias = ?,
                status = ?,
                responsavel = ?,
                observacoes = ?,
                atualizado_em = ?
            WHERE id = ?
            `,
            [
                empresa_cedente_id,
                data_operacao,
                taxaNumero,
                modalidadeFinal,
                prazo_dias !== undefined && prazo_dias !== null && prazo_dias !== ""
                    ? Number(prazo_dias)
                    : null,
                statusFinal,
                responsavel || null,
                observacoes || null,
                obterDataHoraCriacaoBrasilia(),
                id
            ]
        );

        if (statusFinal !== atual.status) {
            registrarMovimentacaoNF(
                id,
                `Operação ${statusFinal}`,
                `Status alterado de "${atual.status}" para "${statusFinal}".`,
                null,
                responsavel || null
            );
        }

        res.json({
            mensagem: "Operação de antecipação atualizada com sucesso!"
        });
    } catch (erro) {
        console.error("Erro ao atualizar operação de antecipação:", erro);
        res.status(500).json({
            erro: "Erro ao atualizar a operação de antecipação."
        });
    }
});

app.delete("/operacoes-antecipacao/:id", async (req, res) => {
    try {
        const atual = await dbGet(
            "SELECT id, status FROM operacoes_antecipacao WHERE id = ?",
            [req.params.id]
        );

        if (!atual) {
            return res.status(404).json({
                erro: "Operação não encontrada."
            });
        }

        if (atual.status === "Ativa" || atual.status === "Concluída") {
            return res.status(400).json({
                erro:
                    "Operações Ativas ou Concluídas não podem ser excluídas, pois já movimentaram (ou movimentam) dinheiro real. Cancele a operação em vez de excluí-la."
            });
        }

        // Mesma classe de bug corrigida em empresas_cedentes e sacados:
        // notas_fiscais usa INNER JOIN com operacoes_antecipacao — excluir
        // uma operação (mesmo Aprovada/Cancelada) com NF já cadastrada
        // tornaria essa NF e todo o seu histórico de recebimentos
        // inacessíveis, órfãos no banco.
        const notaVinculada = await dbGet(
            "SELECT id FROM notas_fiscais WHERE operacao_id = ? LIMIT 1",
            [req.params.id]
        );

        if (notaVinculada) {
            return res.status(400).json({
                erro: "Esta operação possui notas fiscais vinculadas e não pode ser excluída — esse é o histórico real da operação."
            });
        }

        await dbRun(
            "DELETE FROM operacoes_antecipacao WHERE id = ?",
            [req.params.id]
        );

        res.json({
            mensagem: "Operação de antecipação excluída com sucesso!"
        });
    } catch (erro) {
        console.error("Erro ao excluir operação de antecipação:", erro);
        res.status(500).json({
            erro: "Erro ao excluir a operação de antecipação."
        });
    }
});

// ==========================
// NOTAS FISCAIS — Etapa 5
// ==========================

// "Recebida" ainda não entra aqui — depende de recebimentos_nf (Etapa 6).
// Até lá, uma NF não cancelada só pode estar Em Aberto ou Vencida.
// Situação final da NF (Etapa 6 completa esse cálculo): Cancelada > Recebida
// (saldo zerado) > Vencida (venceu, ainda em aberto) > Em Aberto. Nunca
// gravado — sempre recalculado a partir de recebimentos_nf, mesma
// disciplina de saldo_restante em Empréstimos.
function comSituacao(nota) {
    const hoje = obterHojeISO();

    const totalAplicado = Number(nota.total_aplicado || 0);
    const saldoRestante = Math.max(0, Number(nota.valor || 0) - totalAplicado);

    let situacao;

    if (nota.cancelada) {
        situacao = "Cancelada";
    } else if (saldoRestante <= 0.009) {
        situacao = "Recebida";
    } else if (nota.data_vencimento && nota.data_vencimento < hoje) {
        situacao = "Vencida";
    } else {
        situacao = "Em Aberto";
    }

    return {
        ...nota,
        cancelada: !!nota.cancelada,
        total_aplicado: totalAplicado,
        total_recebido: Number(nota.total_recebido || 0),
        total_juros_recebidos: Number(nota.total_juros_recebidos || 0),
        total_multas_recebidas: Number(nota.total_multas_recebidas || 0),
        total_desconto: Number(nota.total_desconto || 0),
        saldo_restante: saldoRestante,
        situacao
    };
}

// total_aplicado é o que efetivamente reduz o saldo da NF (só tipo
// 'Recebimento' + desconto); total_recebido é só o dinheiro (sem o
// desconto); juros/multa nunca entram nessa conta — mesma separação de
// conceitos que recebimentos_parcelas precisou ganhar depois, aqui já
// nasce certa.
const SELECT_NOTA_FISCAL = `
    SELECT
        n.*,
        o.numero_operacao,
        o.status AS operacao_status,
        s.nome AS sacado_nome,
        s.cnpj_cpf AS sacado_cnpj_cpf,
        COALESCE((
            SELECT SUM(CASE WHEN r.tipo = 'Recebimento' THEN r.valor_recebido + r.desconto ELSE 0 END)
            FROM recebimentos_nf r
            WHERE r.nota_fiscal_id = n.id
        ), 0) AS total_aplicado,
        COALESCE((
            SELECT SUM(CASE WHEN r.tipo = 'Recebimento' THEN r.valor_recebido ELSE 0 END)
            FROM recebimentos_nf r
            WHERE r.nota_fiscal_id = n.id
        ), 0) AS total_recebido,
        COALESCE((
            SELECT SUM(CASE WHEN r.tipo = 'Juros' THEN r.valor_recebido ELSE 0 END)
            FROM recebimentos_nf r
            WHERE r.nota_fiscal_id = n.id
        ), 0) AS total_juros_recebidos,
        COALESCE((
            SELECT SUM(CASE WHEN r.tipo = 'Multa' THEN r.valor_recebido ELSE 0 END)
            FROM recebimentos_nf r
            WHERE r.nota_fiscal_id = n.id
        ), 0) AS total_multas_recebidas,
        COALESCE((
            SELECT SUM(r.desconto)
            FROM recebimentos_nf r
            WHERE r.nota_fiscal_id = n.id AND r.tipo = 'Recebimento'
        ), 0) AS total_desconto
    FROM notas_fiscais n
    INNER JOIN operacoes_antecipacao o ON o.id = n.operacao_id
    INNER JOIN sacados s ON s.id = n.sacado_id
`;

app.get("/operacoes-antecipacao/:id/notas-fiscais", async (req, res) => {
    try {
        const operacao = await dbGet(
            "SELECT id FROM operacoes_antecipacao WHERE id = ?",
            [req.params.id]
        );

        if (!operacao) {
            return res.status(404).json({
                erro: "Operação não encontrada."
            });
        }

        const linhas = await dbAll(
            `${SELECT_NOTA_FISCAL} WHERE n.operacao_id = ? ORDER BY n.data_vencimento ASC, n.id ASC`,
            [req.params.id]
        );

        res.json(linhas.map(comSituacao));
    } catch (erro) {
        console.error("Erro ao listar notas fiscais da operação:", erro);
        res.status(500).json({
            erro: "Erro ao listar as notas fiscais da operação."
        });
    }
});

app.get("/notas-fiscais", async (req, res) => {
    try {
        const { operacao_id, sacado_id, situacao, busca } = req.query;

        const clausulas = [];
        const params = [];

        if (operacao_id) {
            clausulas.push("n.operacao_id = ?");
            params.push(operacao_id);
        }

        if (sacado_id) {
            clausulas.push("n.sacado_id = ?");
            params.push(sacado_id);
        }

        if (busca) {
            clausulas.push(
                "(n.numero_nf LIKE ? OR o.numero_operacao LIKE ? OR s.nome LIKE ?)"
            );
            const termo = `%${busca}%`;
            params.push(termo, termo, termo);
        }

        const where = clausulas.length
            ? `WHERE ${clausulas.join(" AND ")}`
            : "";

        const linhas = await dbAll(
            `${SELECT_NOTA_FISCAL} ${where} ORDER BY n.data_vencimento ASC, n.id ASC`,
            params
        );

        let resultado = linhas.map(comSituacao);

        // Situação é calculada, então o filtro por situação também
        // precisa ser aplicado depois de calculada, não em SQL.
        if (situacao) {
            resultado = resultado.filter((nota) => nota.situacao === situacao);
        }

        res.json(resultado);
    } catch (erro) {
        console.error("Erro ao listar notas fiscais:", erro);
        res.status(500).json({
            erro: "Erro ao listar as notas fiscais."
        });
    }
});

app.get("/notas-fiscais/:id", async (req, res) => {
    try {
        const nota = await dbGet(
            `${SELECT_NOTA_FISCAL} WHERE n.id = ?`,
            [req.params.id]
        );

        if (!nota) {
            return res.status(404).json({
                erro: "Nota fiscal não encontrada."
            });
        }

        res.json(comSituacao(nota));
    } catch (erro) {
        console.error("Erro ao buscar nota fiscal:", erro);
        res.status(500).json({
            erro: "Erro ao buscar a nota fiscal."
        });
    }
});

app.post("/notas-fiscais", async (req, res) => {
    const {
        operacao_id,
        numero_nf,
        serie,
        chave_acesso,
        data_emissao,
        data_vencimento,
        valor,
        sacado_id,
        observacoes
    } = req.body;

    if (!operacao_id) {
        return res.status(400).json({
            erro: "Selecione a operação."
        });
    }

    if (!numero_nf || !numero_nf.trim()) {
        return res.status(400).json({
            erro: "Informe o número da nota fiscal."
        });
    }

    if (!data_vencimento) {
        return res.status(400).json({
            erro: "Informe a data de vencimento."
        });
    }

    const valorNumero = Number(valor);

    if (!Number.isFinite(valorNumero) || valorNumero <= 0) {
        return res.status(400).json({
            erro: "Informe um valor válido, maior que zero."
        });
    }

    if (!sacado_id) {
        return res.status(400).json({
            erro: "Selecione o sacado."
        });
    }

    try {
        const operacao = await dbGet(
            "SELECT id, status FROM operacoes_antecipacao WHERE id = ?",
            [operacao_id]
        );

        if (!operacao) {
            return res.status(400).json({
                erro: "Operação não encontrada."
            });
        }

        if (operacao.status === "Ativa" || operacao.status === "Concluída" || operacao.status === "Cancelada") {
            return res.status(400).json({
                erro:
                    "Não é possível adicionar notas fiscais depois do repasse confirmado (operação Ativa, Concluída ou Cancelada) — o valor de face fica travado a partir daí."
            });
        }

        const sacado = await dbGet(
            "SELECT id, nome FROM sacados WHERE id = ?",
            [sacado_id]
        );

        if (!sacado) {
            return res.status(400).json({
                erro: "Sacado não encontrado."
            });
        }

        const agora = obterDataHoraCriacaoBrasilia();

        const resultado = await dbRun(
            `
            INSERT INTO notas_fiscais (
                operacao_id, numero_nf, serie, chave_acesso,
                data_emissao, data_vencimento, valor, sacado_id,
                cancelada, observacoes, criado_em, atualizado_em
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
            `,
            [
                operacao_id,
                numero_nf.trim(),
                serie || null,
                chave_acesso || null,
                data_emissao || null,
                data_vencimento,
                valorNumero,
                sacado_id,
                observacoes || null,
                agora,
                agora
            ]
        );

        registrarMovimentacaoNF(
            operacao_id,
            "Nota Fiscal Cadastrada",
            `NF ${numero_nf.trim()} cadastrada — vencimento ${data_vencimento}, sacado ${sacado.nome}.`,
            valorNumero
        );

        res.json({
            id: resultado.lastID,
            mensagem: "Nota fiscal cadastrada com sucesso!"
        });
    } catch (erro) {
        console.error("Erro ao cadastrar nota fiscal:", erro);
        res.status(500).json({
            erro: "Erro ao cadastrar a nota fiscal."
        });
    }
});

app.put("/notas-fiscais/:id", async (req, res) => {
    const { id } = req.params;
    const {
        numero_nf,
        serie,
        chave_acesso,
        data_emissao,
        data_vencimento,
        valor,
        sacado_id,
        cancelada,
        observacoes
    } = req.body;

    try {
        const atual = await dbGet(
            `
            SELECT n.*, o.status AS operacao_status
            FROM notas_fiscais n
            INNER JOIN operacoes_antecipacao o ON o.id = n.operacao_id
            WHERE n.id = ?
            `,
            [id]
        );

        if (!atual) {
            return res.status(404).json({
                erro: "Nota fiscal não encontrada."
            });
        }

        if (atual.operacao_status === "Ativa" || atual.operacao_status === "Concluída" || atual.operacao_status === "Cancelada") {
            return res.status(400).json({
                erro:
                    "Não é possível alterar notas fiscais depois do repasse confirmado (operação Ativa, Concluída ou Cancelada) — só recebimentos podem ser lançados a partir daí."
            });
        }

        // Mesma robustez de Empréstimos: valor/vencimento/sacado/
        // cancelamento não podem mudar depois que já existe recebimento
        // real contra a NF — só descrição/observações podem ser
        // corrigidas a partir daí.
        const totalAplicadoAtual = await dbGet(
            `
            SELECT COALESCE(SUM(
                CASE WHEN tipo = 'Recebimento' THEN valor_recebido + desconto ELSE 0 END
            ), 0) AS total
            FROM recebimentos_nf
            WHERE nota_fiscal_id = ?
            `,
            [id]
        );

        const jaTemRecebimento = Number(totalAplicadoAtual.total || 0) > 0.009;

        if (jaTemRecebimento) {
            const valorMudou =
                valor !== undefined && Number(valor) !== Number(atual.valor);
            const vencimentoMudou =
                data_vencimento !== undefined && data_vencimento !== atual.data_vencimento;
            const sacadoMudou =
                sacado_id !== undefined && Number(sacado_id) !== Number(atual.sacado_id);
            const cancelamentoMudou =
                cancelada !== undefined && !!cancelada !== !!atual.cancelada;

            if (valorMudou || vencimentoMudou || sacadoMudou || cancelamentoMudou) {
                return res.status(400).json({
                    erro:
                        "Esta nota fiscal já possui recebimentos registrados. Valor, vencimento, sacado e cancelamento não podem ser alterados — apenas número, série, chave de acesso e observações."
                });
            }
        }

        if (!numero_nf || !numero_nf.trim()) {
            return res.status(400).json({
                erro: "Informe o número da nota fiscal."
            });
        }

        if (!data_vencimento) {
            return res.status(400).json({
                erro: "Informe a data de vencimento."
            });
        }

        const valorNumero = Number(valor);

        if (!Number.isFinite(valorNumero) || valorNumero <= 0) {
            return res.status(400).json({
                erro: "Informe um valor válido, maior que zero."
            });
        }

        if (!sacado_id) {
            return res.status(400).json({
                erro: "Selecione o sacado."
            });
        }

        const sacado = await dbGet(
            "SELECT id FROM sacados WHERE id = ?",
            [sacado_id]
        );

        if (!sacado) {
            return res.status(400).json({
                erro: "Sacado não encontrado."
            });
        }

        const foiCanceladaAgora = !!cancelada && !atual.cancelada;

        await dbRun(
            `
            UPDATE notas_fiscais
            SET
                numero_nf = ?,
                serie = ?,
                chave_acesso = ?,
                data_emissao = ?,
                data_vencimento = ?,
                valor = ?,
                sacado_id = ?,
                cancelada = ?,
                observacoes = ?,
                atualizado_em = ?
            WHERE id = ?
            `,
            [
                numero_nf.trim(),
                serie || null,
                chave_acesso || null,
                data_emissao || null,
                data_vencimento,
                valorNumero,
                sacado_id,
                cancelada ? 1 : 0,
                observacoes || null,
                obterDataHoraCriacaoBrasilia(),
                id
            ]
        );

        if (foiCanceladaAgora) {
            registrarMovimentacaoNF(
                atual.operacao_id,
                "Nota Fiscal Cancelada",
                `NF ${numero_nf.trim()} cancelada.`
            );
        }

        res.json({
            mensagem: "Nota fiscal atualizada com sucesso!"
        });
    } catch (erro) {
        console.error("Erro ao atualizar nota fiscal:", erro);
        res.status(500).json({
            erro: "Erro ao atualizar a nota fiscal."
        });
    }
});

app.delete("/notas-fiscais/:id", async (req, res) => {
    try {
        const atual = await dbGet(
            `
            SELECT n.id, n.numero_nf, n.operacao_id, o.status AS operacao_status
            FROM notas_fiscais n
            INNER JOIN operacoes_antecipacao o ON o.id = n.operacao_id
            WHERE n.id = ?
            `,
            [req.params.id]
        );

        if (!atual) {
            return res.status(404).json({
                erro: "Nota fiscal não encontrada."
            });
        }

        if (atual.operacao_status === "Ativa" || atual.operacao_status === "Concluída" || atual.operacao_status === "Cancelada") {
            return res.status(400).json({
                erro:
                    "Não é possível excluir notas fiscais depois do repasse confirmado (operação Ativa, Concluída ou Cancelada)."
            });
        }

        const totalAplicadoAtual = await dbGet(
            `
            SELECT COALESCE(SUM(
                CASE WHEN tipo = 'Recebimento' THEN valor_recebido + desconto ELSE 0 END
            ), 0) AS total
            FROM recebimentos_nf
            WHERE nota_fiscal_id = ?
            `,
            [req.params.id]
        );

        if (Number(totalAplicadoAtual.total || 0) > 0.009) {
            return res.status(400).json({
                erro:
                    "Esta nota fiscal já possui recebimentos registrados e não pode ser excluída nem cancelada — esse é o histórico financeiro real da operação."
            });
        }

        await dbRun(
            "DELETE FROM notas_fiscais WHERE id = ?",
            [req.params.id]
        );

        registrarMovimentacaoNF(
            atual.operacao_id,
            "Nota Fiscal Excluída",
            `NF ${atual.numero_nf} excluída.`
        );

        res.json({
            mensagem: "Nota fiscal excluída com sucesso!"
        });
    } catch (erro) {
        console.error("Erro ao excluir nota fiscal:", erro);
        res.status(500).json({
            erro: "Erro ao excluir a nota fiscal."
        });
    }
});

// ==========================
// RECEBIMENTOS DE NF — Etapa 6
// ==========================

const TIPOS_RECEBIMENTO_NF = ["Recebimento", "Juros", "Multa"];

app.get("/notas-fiscais/:id/recebimentos", async (req, res) => {
    try {
        const nota = await dbGet(
            `${SELECT_NOTA_FISCAL} WHERE n.id = ?`,
            [req.params.id]
        );

        if (!nota) {
            return res.status(404).json({
                erro: "Nota fiscal não encontrada."
            });
        }

        const linhas = await dbAll(
            `
            SELECT *
            FROM recebimentos_nf
            WHERE nota_fiscal_id = ?
            ORDER BY data_recebimento ASC, id ASC
            `,
            [req.params.id]
        );

        const notaComSituacao = comSituacao(nota);

        res.json({
            notaFiscal: notaComSituacao,
            resumo: {
                quantidadeRecebimentos: linhas.length,
                totalRecebido: notaComSituacao.total_recebido,
                totalAplicado: notaComSituacao.total_aplicado,
                totalJurosRecebidos: notaComSituacao.total_juros_recebidos,
                totalMultasRecebidas: notaComSituacao.total_multas_recebidas,
                totalDesconto: notaComSituacao.total_desconto,
                saldoRestante: notaComSituacao.saldo_restante
            },
            recebimentos: linhas.map((recebimento) => ({
                ...recebimento,
                valor_recebido: Number(recebimento.valor_recebido || 0),
                desconto: Number(recebimento.desconto || 0)
            }))
        });
    } catch (erro) {
        console.error("Erro ao consultar recebimentos da nota fiscal:", erro);
        res.status(500).json({
            erro: "Erro ao consultar o histórico de recebimentos."
        });
    }
});

app.post("/notas-fiscais/:id/recebimentos", async (req, res) => {
    const { id } = req.params;
    const {
        data_recebimento,
        valor_recebido,
        tipo,
        desconto,
        usuario,
        observacoes
    } = req.body;

    const tipoFinal = tipo || "Recebimento";

    if (!TIPOS_RECEBIMENTO_NF.includes(tipoFinal)) {
        return res.status(400).json({
            erro: `Tipo inválido. Use um de: ${TIPOS_RECEBIMENTO_NF.join(", ")}.`
        });
    }

    if (!data_recebimento) {
        return res.status(400).json({
            erro: "Informe a data do recebimento."
        });
    }

    const valorNumero = Number(valor_recebido);

    if (!Number.isFinite(valorNumero) || valorNumero <= 0) {
        return res.status(400).json({
            erro: "Informe um valor recebido maior que zero."
        });
    }

    const descontoNumero = Number(desconto) || 0;

    if (descontoNumero < 0) {
        return res.status(400).json({
            erro: "O desconto não pode ser negativo."
        });
    }

    try {
        const nota = await dbGet(
            `${SELECT_NOTA_FISCAL} WHERE n.id = ?`,
            [id]
        );

        if (!nota) {
            return res.status(404).json({
                erro: "Nota fiscal não encontrada."
            });
        }

        if (nota.cancelada) {
            return res.status(400).json({
                erro: "Não é possível registrar recebimento em uma nota fiscal cancelada."
            });
        }

        if (nota.operacao_status === "Concluída" || nota.operacao_status === "Cancelada") {
            return res.status(400).json({
                erro:
                    "Não é possível registrar recebimento em uma operação Concluída ou Cancelada."
            });
        }

        const notaComSituacao = comSituacao(nota);

        // Só o tipo "Recebimento" reduz o saldo — por isso só ele pode
        // estourar o valor da NF. Juros e Multa são receita à parte,
        // sem teto (mesma regra de "Recebimento Somente de Juros" em
        // Empréstimos).
        if (tipoFinal === "Recebimento") {
            const totalAposEste =
                notaComSituacao.total_aplicado + valorNumero + descontoNumero;

            if (totalAposEste > Number(nota.valor) + 0.009) {
                return res.status(400).json({
                    erro: "O valor informado é maior que o saldo restante da nota fiscal.",
                    mensagem: `O saldo atual da nota fiscal é de R$ ${notaComSituacao.saldo_restante.toFixed(2)}.`,
                    saldoRestante: notaComSituacao.saldo_restante
                });
            }
        }

        const agora = obterDataHoraCriacaoBrasilia();

        const resultado = await dbRun(
            `
            INSERT INTO recebimentos_nf (
                nota_fiscal_id, data_recebimento, valor_recebido, tipo,
                desconto, usuario, observacoes, criado_em
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                id,
                data_recebimento,
                valorNumero,
                tipoFinal,
                descontoNumero,
                usuario || null,
                observacoes || null,
                agora
            ]
        );

        // Devolve a NF já com saldo/situação recalculados — a mesma
        // consulta que qualquer outra tela vai usar depois, então não
        // existe um "saldo em cache" para dessincronizar.
        const notaAtualizada = await dbGet(
            `${SELECT_NOTA_FISCAL} WHERE n.id = ?`,
            [id]
        );

        const notaComSituacaoAtualizada = comSituacao(notaAtualizada);

        const tipoMovimentacao =
            tipoFinal === "Recebimento"
                ? "Recebimento de NF"
                : tipoFinal === "Juros"
                    ? "Juros de NF"
                    : "Multa de NF";

        registrarMovimentacaoNF(
            nota.operacao_id,
            tipoMovimentacao,
            `NF ${nota.numero_nf} — ${tipoFinal.toLowerCase()} de R$ ${valorNumero.toFixed(2)}` +
            (descontoNumero > 0 ? `, desconto de R$ ${descontoNumero.toFixed(2)}` : "") +
            `. Saldo restante: R$ ${notaComSituacaoAtualizada.saldo_restante.toFixed(2)}.`,
            valorNumero,
            usuario || null
        );

        res.json({
            id: resultado.lastID,
            mensagem: "Recebimento registrado com sucesso!",
            notaFiscal: notaComSituacaoAtualizada
        });
    } catch (erro) {
        console.error("Erro ao registrar recebimento de nota fiscal:", erro);
        res.status(500).json({
            erro: "Erro ao registrar o recebimento."
        });
    }
});

// ==========================
// COMISSÕES DA OPERAÇÃO — Etapa 7
// ==========================

const TIPOS_COMISSAO_OPERACAO = ["fixa", "percentual"];
const BASES_CALCULO_COMISSAO = ["desagio", "valor_face"];
const STATUS_COMISSAO = ["Pendente", "Aprovada", "Paga", "Cancelada"];

// Paga e Cancelada são terminais — de propósito, mesma disciplina de
// "histórico fechado" já usada em operação/NF. Aprovada pode voltar para
// Pendente (uma aprovação pode ser desfeita antes de pagar).
const TRANSICOES_STATUS_COMISSAO = {
    "Pendente": ["Pendente", "Aprovada", "Cancelada"],
    "Aprovada": ["Aprovada", "Paga", "Cancelada", "Pendente"],
    "Paga": ["Paga"],
    "Cancelada": ["Cancelada"]
};

const SELECT_COMISSAO = `
    SELECT
        c.*,
        o.numero_operacao,
        o.status AS operacao_status,
        cm.nome AS comissionado_nome,
        cm.cpf_cnpj AS comissionado_cpf_cnpj,
        cm.tipo AS comissionado_tipo
    FROM comissoes_operacao c
    INNER JOIN operacoes_antecipacao o ON o.id = c.operacao_id
    INNER JOIN comissionados cm ON cm.id = c.comissionado_id
`;

function comNumeros(comissao) {
    return {
        ...comissao,
        percentual: comissao.percentual !== null && comissao.percentual !== undefined
            ? Number(comissao.percentual)
            : null,
        valor_fixo: comissao.valor_fixo !== null && comissao.valor_fixo !== undefined
            ? Number(comissao.valor_fixo)
            : null,
        valor_calculado: Number(comissao.valor_calculado || 0)
    };
}

// Valor calculado é um retrato: para "fixa" é só o valor digitado; para
// "percentual" incide sobre o deságio (lucro bruto) ou o valor de face
// ATUAL da operação, conforme a base escolhida — nunca sobre o líquido
// (que já desconta outras comissões, o que criaria uma base móvel).
async function calcularValorComissao(tipoComissao, baseCalculo, percentual, valorFixo, operacaoId) {
    if (tipoComissao === "fixa") {
        return Number(valorFixo) || 0;
    }

    const operacao = await dbGet(
        `SELECT o.*, ${SUBQUERIES_TOTAIS_OPERACAO} FROM operacoes_antecipacao o WHERE o.id = ?`,
        [operacaoId]
    );

    const operacaoComSaldo = comSaldoOperacao(operacao);

    const base =
        baseCalculo === "valor_face"
            ? operacaoComSaldo.valor_face
            : operacaoComSaldo.lucro_bruto;

    return base * (Number(percentual) / 100);
}

app.get("/operacoes-antecipacao/:id/comissoes", async (req, res) => {
    try {
        const operacao = await dbGet(
            "SELECT id FROM operacoes_antecipacao WHERE id = ?",
            [req.params.id]
        );

        if (!operacao) {
            return res.status(404).json({
                erro: "Operação não encontrada."
            });
        }

        const linhas = await dbAll(
            `${SELECT_COMISSAO} WHERE c.operacao_id = ? ORDER BY c.id ASC`,
            [req.params.id]
        );

        res.json(linhas.map(comNumeros));
    } catch (erro) {
        console.error("Erro ao listar comissões da operação:", erro);
        res.status(500).json({
            erro: "Erro ao listar as comissões da operação."
        });
    }
});

app.get("/comissoes", async (req, res) => {
    try {
        const { operacao_id, comissionado_id, status, busca } = req.query;

        const clausulas = [];
        const params = [];

        if (operacao_id) {
            clausulas.push("c.operacao_id = ?");
            params.push(operacao_id);
        }

        if (comissionado_id) {
            clausulas.push("c.comissionado_id = ?");
            params.push(comissionado_id);
        }

        if (status) {
            clausulas.push("c.status = ?");
            params.push(status);
        }

        if (busca) {
            clausulas.push("(o.numero_operacao LIKE ? OR cm.nome LIKE ?)");
            const termo = `%${busca}%`;
            params.push(termo, termo);
        }

        const where = clausulas.length
            ? `WHERE ${clausulas.join(" AND ")}`
            : "";

        const linhas = await dbAll(
            `${SELECT_COMISSAO} ${where} ORDER BY c.id DESC`,
            params
        );

        res.json(linhas.map(comNumeros));
    } catch (erro) {
        console.error("Erro ao listar comissões:", erro);
        res.status(500).json({
            erro: "Erro ao listar as comissões."
        });
    }
});

app.get("/comissoes/:id", async (req, res) => {
    try {
        const comissao = await dbGet(
            `${SELECT_COMISSAO} WHERE c.id = ?`,
            [req.params.id]
        );

        if (!comissao) {
            return res.status(404).json({
                erro: "Comissão não encontrada."
            });
        }

        res.json(comNumeros(comissao));
    } catch (erro) {
        console.error("Erro ao buscar comissão:", erro);
        res.status(500).json({
            erro: "Erro ao buscar a comissão."
        });
    }
});

app.post("/operacoes-antecipacao/:id/comissoes", async (req, res) => {
    const { id } = req.params;
    const {
        comissionado_id,
        tipo_comissao,
        base_calculo,
        percentual,
        valor_fixo,
        observacoes
    } = req.body;

    if (!comissionado_id) {
        return res.status(400).json({
            erro: "Selecione o comissionado."
        });
    }

    const tipoFinal = tipo_comissao || "percentual";

    if (!TIPOS_COMISSAO_OPERACAO.includes(tipoFinal)) {
        return res.status(400).json({
            erro: `Tipo de comissão inválido. Use um de: ${TIPOS_COMISSAO_OPERACAO.join(", ")}.`
        });
    }

    const baseFinal = base_calculo || "desagio";

    if (!BASES_CALCULO_COMISSAO.includes(baseFinal)) {
        return res.status(400).json({
            erro: `Base de cálculo inválida. Use um de: ${BASES_CALCULO_COMISSAO.join(", ")}.`
        });
    }

    let percentualNumero = null;
    let valorFixoNumero = null;

    if (tipoFinal === "percentual") {
        percentualNumero = Number(percentual);

        if (!Number.isFinite(percentualNumero) || percentualNumero <= 0 || percentualNumero > 100) {
            return res.status(400).json({
                erro: "Informe um percentual válido, entre 0 e 100."
            });
        }
    } else {
        valorFixoNumero = Number(valor_fixo);

        if (!Number.isFinite(valorFixoNumero) || valorFixoNumero <= 0) {
            return res.status(400).json({
                erro: "Informe um valor fixo válido, maior que zero."
            });
        }
    }

    try {
        const operacao = await dbGet(
            "SELECT id, status FROM operacoes_antecipacao WHERE id = ?",
            [id]
        );

        if (!operacao) {
            return res.status(400).json({
                erro: "Operação não encontrada."
            });
        }

        if (operacao.status === "Concluída" || operacao.status === "Cancelada") {
            return res.status(400).json({
                erro:
                    "Não é possível adicionar comissões a uma operação Concluída ou Cancelada."
            });
        }

        const comissionado = await dbGet(
            "SELECT id, nome FROM comissionados WHERE id = ?",
            [comissionado_id]
        );

        if (!comissionado) {
            return res.status(400).json({
                erro: "Comissionado não encontrado."
            });
        }

        const valorCalculado = await calcularValorComissao(
            tipoFinal,
            baseFinal,
            percentualNumero,
            valorFixoNumero,
            id
        );

        const agora = obterDataHoraCriacaoBrasilia();

        // Toda comissão nova começa Pendente — status não é aceito do
        // cliente na criação, só evolui pela própria rota de atualização.
        const resultado = await dbRun(
            `
            INSERT INTO comissoes_operacao (
                operacao_id, comissionado_id, tipo_comissao, base_calculo,
                percentual, valor_fixo, valor_calculado, status,
                observacoes, criado_em, atualizado_em
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 'Pendente', ?, ?, ?)
            `,
            [
                id,
                comissionado_id,
                tipoFinal,
                baseFinal,
                percentualNumero,
                valorFixoNumero,
                valorCalculado,
                observacoes || null,
                agora,
                agora
            ]
        );

        registrarMovimentacaoNF(
            id,
            "Comissão Cadastrada",
            `Comissão para ${comissionado.nome} (${tipoFinal === "fixa" ? "valor fixo" : `${percentualNumero}% sobre ${baseFinal === "valor_face" ? "o valor de face" : "o deságio"}`}) no valor de R$ ${valorCalculado.toFixed(2)}.`,
            valorCalculado
        );

        res.json({
            id: resultado.lastID,
            valor_calculado: valorCalculado,
            mensagem: "Comissão cadastrada com sucesso!"
        });
    } catch (erro) {
        console.error("Erro ao cadastrar comissão:", erro);
        res.status(500).json({
            erro: "Erro ao cadastrar a comissão."
        });
    }
});

app.put("/comissoes/:id", async (req, res) => {
    const { id } = req.params;
    const {
        comissionado_id,
        tipo_comissao,
        base_calculo,
        percentual,
        valor_fixo,
        status,
        data_pagamento,
        usuario,
        observacoes
    } = req.body;

    try {
        const atual = await dbGet(
            `${SELECT_COMISSAO} WHERE c.id = ?`,
            [id]
        );

        if (!atual) {
            return res.status(404).json({
                erro: "Comissão não encontrada."
            });
        }

        if (atual.operacao_status === "Concluída" || atual.operacao_status === "Cancelada") {
            if (observacoes === undefined) {
                return res.status(400).json({
                    erro: "Nada para atualizar."
                });
            }

            await dbRun(
                `UPDATE comissoes_operacao SET observacoes = ?, atualizado_em = ? WHERE id = ?`,
                [observacoes || null, obterDataHoraCriacaoBrasilia(), id]
            );

            return res.json({
                mensagem:
                    "Operações Concluídas ou Canceladas fazem parte do histórico financeiro — apenas as observações foram atualizadas."
            });
        }

        const statusAtual = atual.status;
        const statusFinal = status || statusAtual;

        if (!STATUS_COMISSAO.includes(statusFinal)) {
            return res.status(400).json({
                erro: `Status inválido. Use um de: ${STATUS_COMISSAO.join(", ")}.`
            });
        }

        const transicoesPermitidas = TRANSICOES_STATUS_COMISSAO[statusAtual] || [];

        if (!transicoesPermitidas.includes(statusFinal)) {
            return res.status(400).json({
                erro: `Não é possível mudar o status de "${statusAtual}" para "${statusFinal}".`
            });
        }

        // Paga/Cancelada são terminais: só chega aqui com statusFinal
        // igual ao atual (a própria validação de transição já garante
        // isso), então só observações podem mudar.
        if (statusAtual === "Paga" || statusAtual === "Cancelada") {
            if (observacoes === undefined) {
                return res.status(400).json({
                    erro: "Nada para atualizar."
                });
            }

            await dbRun(
                `UPDATE comissoes_operacao SET observacoes = ?, atualizado_em = ? WHERE id = ?`,
                [observacoes || null, obterDataHoraCriacaoBrasilia(), id]
            );

            return res.json({
                mensagem: `Comissão já está ${statusAtual} — apenas as observações foram atualizadas.`
            });
        }

        const comissionadoFinal = comissionado_id || atual.comissionado_id;
        const tipoFinal = tipo_comissao || atual.tipo_comissao;
        const baseFinal = base_calculo || atual.base_calculo;

        if (!TIPOS_COMISSAO_OPERACAO.includes(tipoFinal)) {
            return res.status(400).json({
                erro: `Tipo de comissão inválido. Use um de: ${TIPOS_COMISSAO_OPERACAO.join(", ")}.`
            });
        }

        if (!BASES_CALCULO_COMISSAO.includes(baseFinal)) {
            return res.status(400).json({
                erro: `Base de cálculo inválida. Use um de: ${BASES_CALCULO_COMISSAO.join(", ")}.`
            });
        }

        const comissionado = await dbGet(
            "SELECT id FROM comissionados WHERE id = ?",
            [comissionadoFinal]
        );

        if (!comissionado) {
            return res.status(400).json({
                erro: "Comissionado não encontrado."
            });
        }

        let percentualNumero = null;
        let valorFixoNumero = null;

        if (tipoFinal === "percentual") {
            percentualNumero = percentual !== undefined ? Number(percentual) : Number(atual.percentual);

            if (!Number.isFinite(percentualNumero) || percentualNumero <= 0 || percentualNumero > 100) {
                return res.status(400).json({
                    erro: "Informe um percentual válido, entre 0 e 100."
                });
            }
        } else {
            valorFixoNumero = valor_fixo !== undefined ? Number(valor_fixo) : Number(atual.valor_fixo);

            if (!Number.isFinite(valorFixoNumero) || valorFixoNumero <= 0) {
                return res.status(400).json({
                    erro: "Informe um valor fixo válido, maior que zero."
                });
            }
        }

        const valorCalculado = await calcularValorComissao(
            tipoFinal,
            baseFinal,
            percentualNumero,
            valorFixoNumero,
            atual.operacao_id
        );

        let dataPagamentoFinal = atual.data_pagamento;

        if (statusFinal === "Paga" && statusAtual !== "Paga") {
            dataPagamentoFinal = data_pagamento || obterHojeISO();
        }

        await dbRun(
            `
            UPDATE comissoes_operacao
            SET
                comissionado_id = ?,
                tipo_comissao = ?,
                base_calculo = ?,
                percentual = ?,
                valor_fixo = ?,
                valor_calculado = ?,
                status = ?,
                data_pagamento = ?,
                usuario = ?,
                observacoes = ?,
                atualizado_em = ?
            WHERE id = ?
            `,
            [
                comissionadoFinal,
                tipoFinal,
                baseFinal,
                percentualNumero,
                valorFixoNumero,
                valorCalculado,
                statusFinal,
                dataPagamentoFinal,
                usuario || atual.usuario || null,
                observacoes !== undefined ? observacoes : atual.observacoes,
                obterDataHoraCriacaoBrasilia(),
                id
            ]
        );

        if (statusFinal !== statusAtual) {
            registrarMovimentacaoNF(
                atual.operacao_id,
                `Comissão ${statusFinal}`,
                `Comissão de ${atual.comissionado_nome} alterada de "${statusAtual}" para "${statusFinal}" (R$ ${valorCalculado.toFixed(2)}).`,
                statusFinal === "Paga" ? valorCalculado : null,
                usuario || atual.usuario || null
            );
        }

        res.json({
            mensagem: "Comissão atualizada com sucesso!",
            valor_calculado: valorCalculado
        });
    } catch (erro) {
        console.error("Erro ao atualizar comissão:", erro);
        res.status(500).json({
            erro: "Erro ao atualizar a comissão."
        });
    }
});

app.delete("/comissoes/:id", async (req, res) => {
    try {
        const atual = await dbGet(
            "SELECT id, status, operacao_id FROM comissoes_operacao WHERE id = ?",
            [req.params.id]
        );

        if (!atual) {
            return res.status(404).json({
                erro: "Comissão não encontrada."
            });
        }

        if (atual.status === "Paga" || atual.status === "Cancelada") {
            return res.status(400).json({
                erro:
                    "Comissões Pagas ou Canceladas não podem ser excluídas — esse é o histórico financeiro real da operação."
            });
        }

        const operacao = await dbGet(
            "SELECT status FROM operacoes_antecipacao WHERE id = ?",
            [atual.operacao_id]
        );

        if (operacao && (operacao.status === "Concluída" || operacao.status === "Cancelada")) {
            return res.status(400).json({
                erro:
                    "Não é possível excluir comissões de uma operação Concluída ou Cancelada."
            });
        }

        await dbRun(
            "DELETE FROM comissoes_operacao WHERE id = ?",
            [req.params.id]
        );

        res.json({
            mensagem: "Comissão excluída com sucesso!"
        });
    } catch (erro) {
        console.error("Erro ao excluir comissão:", erro);
        res.status(500).json({
            erro: "Erro ao excluir a comissão."
        });
    }
});

// ==========================
// CUSTOS DA OPERAÇÃO — Etapa 8
// ==========================

const RESPONSAVEIS_CUSTO = ["Cedente", "AX Holding"];
const STATUS_CUSTO = ["Pendente", "Aprovado", "Pago", "Cancelado"];

// Mesma máquina de estados de comissoes_operacao — Pago/Cancelado são
// terminais, Aprovado pode voltar para Pendente.
const TRANSICOES_STATUS_CUSTO = {
    "Pendente": ["Pendente", "Aprovado", "Cancelado"],
    "Aprovado": ["Aprovado", "Pago", "Cancelado", "Pendente"],
    "Pago": ["Pago"],
    "Cancelado": ["Cancelado"]
};

const SELECT_CUSTO = `
    SELECT
        cu.*,
        o.numero_operacao,
        o.status AS operacao_status
    FROM custos_operacao cu
    INNER JOIN operacoes_antecipacao o ON o.id = cu.operacao_id
`;

function comNumerosCusto(custo) {
    return {
        ...custo,
        valor: Number(custo.valor || 0)
    };
}

app.get("/operacoes-antecipacao/:id/custos", async (req, res) => {
    try {
        const operacao = await dbGet(
            "SELECT id FROM operacoes_antecipacao WHERE id = ?",
            [req.params.id]
        );

        if (!operacao) {
            return res.status(404).json({
                erro: "Operação não encontrada."
            });
        }

        const linhas = await dbAll(
            `${SELECT_CUSTO} WHERE cu.operacao_id = ? ORDER BY cu.id ASC`,
            [req.params.id]
        );

        res.json(linhas.map(comNumerosCusto));
    } catch (erro) {
        console.error("Erro ao listar custos da operação:", erro);
        res.status(500).json({
            erro: "Erro ao listar os custos da operação."
        });
    }
});

app.get("/custos", async (req, res) => {
    try {
        const { operacao_id, responsavel_custo, status, categoria, busca } = req.query;

        const clausulas = [];
        const params = [];

        if (operacao_id) {
            clausulas.push("cu.operacao_id = ?");
            params.push(operacao_id);
        }

        if (responsavel_custo) {
            clausulas.push("cu.responsavel_custo = ?");
            params.push(responsavel_custo);
        }

        if (status) {
            clausulas.push("cu.status = ?");
            params.push(status);
        }

        if (categoria) {
            clausulas.push("cu.categoria = ?");
            params.push(categoria);
        }

        if (busca) {
            clausulas.push("(o.numero_operacao LIKE ? OR cu.descricao LIKE ?)");
            const termo = `%${busca}%`;
            params.push(termo, termo);
        }

        const where = clausulas.length
            ? `WHERE ${clausulas.join(" AND ")}`
            : "";

        const linhas = await dbAll(
            `${SELECT_CUSTO} ${where} ORDER BY cu.id DESC`,
            params
        );

        res.json(linhas.map(comNumerosCusto));
    } catch (erro) {
        console.error("Erro ao listar custos:", erro);
        res.status(500).json({
            erro: "Erro ao listar os custos."
        });
    }
});

app.get("/custos/:id", async (req, res) => {
    try {
        const custo = await dbGet(
            `${SELECT_CUSTO} WHERE cu.id = ?`,
            [req.params.id]
        );

        if (!custo) {
            return res.status(404).json({
                erro: "Custo não encontrado."
            });
        }

        res.json(comNumerosCusto(custo));
    } catch (erro) {
        console.error("Erro ao buscar custo:", erro);
        res.status(500).json({
            erro: "Erro ao buscar o custo."
        });
    }
});

app.post("/operacoes-antecipacao/:id/custos", async (req, res) => {
    const { id } = req.params;
    const {
        categoria,
        descricao,
        valor,
        responsavel_custo,
        observacoes
    } = req.body;

    if (!categoria || !categoria.trim()) {
        return res.status(400).json({
            erro: "Informe a categoria do custo."
        });
    }

    const valorNumero = Number(valor);

    if (!Number.isFinite(valorNumero) || valorNumero <= 0) {
        return res.status(400).json({
            erro: "Informe um valor válido, maior que zero."
        });
    }

    const responsavelFinal = responsavel_custo || "AX Holding";

    if (!RESPONSAVEIS_CUSTO.includes(responsavelFinal)) {
        return res.status(400).json({
            erro: `Responsável inválido. Use um de: ${RESPONSAVEIS_CUSTO.join(", ")}.`
        });
    }

    try {
        const operacao = await dbGet(
            "SELECT id, status FROM operacoes_antecipacao WHERE id = ?",
            [id]
        );

        if (!operacao) {
            return res.status(400).json({
                erro: "Operação não encontrada."
            });
        }

        if (operacao.status === "Concluída" || operacao.status === "Cancelada") {
            return res.status(400).json({
                erro:
                    "Não é possível adicionar custos a uma operação Concluída ou Cancelada."
            });
        }

        const agora = obterDataHoraCriacaoBrasilia();

        // Todo custo novo começa Pendente — status não é aceito do
        // cliente na criação, só evolui pela rota de atualização.
        const resultado = await dbRun(
            `
            INSERT INTO custos_operacao (
                operacao_id, categoria, descricao, valor, responsavel_custo,
                status, observacoes, criado_em, atualizado_em
            )
            VALUES (?, ?, ?, ?, ?, 'Pendente', ?, ?, ?)
            `,
            [
                id,
                categoria.trim(),
                descricao || null,
                valorNumero,
                responsavelFinal,
                observacoes || null,
                agora,
                agora
            ]
        );

        registrarMovimentacaoNF(
            id,
            "Custo Cadastrado",
            `Custo de ${categoria.trim()} (responsável: ${responsavelFinal}) no valor de R$ ${valorNumero.toFixed(2)}.`,
            valorNumero
        );

        res.json({
            id: resultado.lastID,
            mensagem: "Custo cadastrado com sucesso!"
        });
    } catch (erro) {
        console.error("Erro ao cadastrar custo:", erro);
        res.status(500).json({
            erro: "Erro ao cadastrar o custo."
        });
    }
});

app.put("/custos/:id", async (req, res) => {
    const { id } = req.params;
    const {
        categoria,
        descricao,
        valor,
        responsavel_custo,
        status,
        data_pagamento,
        usuario,
        observacoes
    } = req.body;

    try {
        const atual = await dbGet(
            `${SELECT_CUSTO} WHERE cu.id = ?`,
            [id]
        );

        if (!atual) {
            return res.status(404).json({
                erro: "Custo não encontrado."
            });
        }

        if (atual.operacao_status === "Concluída" || atual.operacao_status === "Cancelada") {
            if (observacoes === undefined) {
                return res.status(400).json({
                    erro: "Nada para atualizar."
                });
            }

            await dbRun(
                `UPDATE custos_operacao SET observacoes = ?, atualizado_em = ? WHERE id = ?`,
                [observacoes || null, obterDataHoraCriacaoBrasilia(), id]
            );

            return res.json({
                mensagem:
                    "Operações Concluídas ou Canceladas fazem parte do histórico financeiro — apenas as observações foram atualizadas."
            });
        }

        const statusAtual = atual.status;
        const statusFinal = status || statusAtual;

        if (!STATUS_CUSTO.includes(statusFinal)) {
            return res.status(400).json({
                erro: `Status inválido. Use um de: ${STATUS_CUSTO.join(", ")}.`
            });
        }

        const transicoesPermitidas = TRANSICOES_STATUS_CUSTO[statusAtual] || [];

        if (!transicoesPermitidas.includes(statusFinal)) {
            return res.status(400).json({
                erro: `Não é possível mudar o status de "${statusAtual}" para "${statusFinal}".`
            });
        }

        // Pago/Cancelado são terminais: só chega aqui com statusFinal
        // igual ao atual, então só observações podem mudar.
        if (statusAtual === "Pago" || statusAtual === "Cancelado") {
            if (observacoes === undefined) {
                return res.status(400).json({
                    erro: "Nada para atualizar."
                });
            }

            await dbRun(
                `UPDATE custos_operacao SET observacoes = ?, atualizado_em = ? WHERE id = ?`,
                [observacoes || null, obterDataHoraCriacaoBrasilia(), id]
            );

            return res.json({
                mensagem: `Custo já está ${statusAtual} — apenas as observações foram atualizadas.`
            });
        }

        const categoriaFinal = categoria !== undefined ? categoria : atual.categoria;

        if (!categoriaFinal || !categoriaFinal.trim()) {
            return res.status(400).json({
                erro: "Informe a categoria do custo."
            });
        }

        const valorNumero = valor !== undefined ? Number(valor) : Number(atual.valor);

        if (!Number.isFinite(valorNumero) || valorNumero <= 0) {
            return res.status(400).json({
                erro: "Informe um valor válido, maior que zero."
            });
        }

        const responsavelFinal = responsavel_custo || atual.responsavel_custo;

        if (!RESPONSAVEIS_CUSTO.includes(responsavelFinal)) {
            return res.status(400).json({
                erro: `Responsável inválido. Use um de: ${RESPONSAVEIS_CUSTO.join(", ")}.`
            });
        }

        let dataPagamentoFinal = atual.data_pagamento;

        if (statusFinal === "Pago" && statusAtual !== "Pago") {
            dataPagamentoFinal = data_pagamento || obterHojeISO();
        }

        await dbRun(
            `
            UPDATE custos_operacao
            SET
                categoria = ?,
                descricao = ?,
                valor = ?,
                responsavel_custo = ?,
                status = ?,
                data_pagamento = ?,
                usuario = ?,
                observacoes = ?,
                atualizado_em = ?
            WHERE id = ?
            `,
            [
                categoriaFinal.trim(),
                descricao !== undefined ? descricao : atual.descricao,
                valorNumero,
                responsavelFinal,
                statusFinal,
                dataPagamentoFinal,
                usuario || atual.usuario || null,
                observacoes !== undefined ? observacoes : atual.observacoes,
                obterDataHoraCriacaoBrasilia(),
                id
            ]
        );

        if (statusFinal !== statusAtual) {
            registrarMovimentacaoNF(
                atual.operacao_id,
                `Custo ${statusFinal}`,
                `Custo de ${atual.categoria} (responsável: ${atual.responsavel_custo}) alterado de "${statusAtual}" para "${statusFinal}" (R$ ${valorNumero.toFixed(2)}).`,
                statusFinal === "Pago" ? valorNumero : null,
                usuario || atual.usuario || null
            );
        }

        res.json({
            mensagem: "Custo atualizado com sucesso!"
        });
    } catch (erro) {
        console.error("Erro ao atualizar custo:", erro);
        res.status(500).json({
            erro: "Erro ao atualizar o custo."
        });
    }
});

app.delete("/custos/:id", async (req, res) => {
    try {
        const atual = await dbGet(
            "SELECT id, status, operacao_id FROM custos_operacao WHERE id = ?",
            [req.params.id]
        );

        if (!atual) {
            return res.status(404).json({
                erro: "Custo não encontrado."
            });
        }

        if (atual.status === "Pago" || atual.status === "Cancelado") {
            return res.status(400).json({
                erro:
                    "Custos Pagos ou Cancelados não podem ser excluídos — esse é o histórico financeiro real da operação."
            });
        }

        const operacao = await dbGet(
            "SELECT status FROM operacoes_antecipacao WHERE id = ?",
            [atual.operacao_id]
        );

        if (operacao && (operacao.status === "Concluída" || operacao.status === "Cancelada")) {
            return res.status(400).json({
                erro:
                    "Não é possível excluir custos de uma operação Concluída ou Cancelada."
            });
        }

        await dbRun(
            "DELETE FROM custos_operacao WHERE id = ?",
            [req.params.id]
        );

        res.json({
            mensagem: "Custo excluído com sucesso!"
        });
    } catch (erro) {
        console.error("Erro ao excluir custo:", erro);
        res.status(500).json({
            erro: "Erro ao excluir o custo."
        });
    }
});

// ==========================
// REPASSE — Etapa 9
// (etapa definitiva do cálculo financeiro da operação)
// ==========================

const FORMAS_PAGAMENTO_REPASSE = ["PIX", "TED", "DOC", "Transferência Interna", "Outros"];

// Nunca desconta custo da AX Holding nem comissão (paga ou não) — só
// valor de face, deságio e custo do CEDENTE já pago. "Lucro líquido
// previsto" reaproveita a mesma fórmula de lucro_liquido usada em toda a
// operação (só Paga/Pago contam) — é "previsto" porque, no momento do
// repasse, nenhuma NF foi recebida ainda, não porque a fórmula muda.
async function calcularPreviaRepasse(operacaoId) {
    const operacao = await dbGet(
        `SELECT o.*, ${SUBQUERIES_TOTAIS_OPERACAO} FROM operacoes_antecipacao o WHERE o.id = ?`,
        [operacaoId]
    );

    if (!operacao) return null;

    const comSaldo = comSaldoOperacao(operacao);

    return {
        operacao_id: operacao.id,
        numero_operacao: operacao.numero_operacao,
        status_operacao: operacao.status,
        valor_face: comSaldo.valor_face,
        desagio: comSaldo.lucro_bruto,
        custos_cedente: comSaldo.total_custos_cedente_pagos,
        valor_liquido_repasse: comSaldo.valor_liquido_repasse,
        lucro_bruto: comSaldo.lucro_bruto,
        lucro_liquido_previsto: comSaldo.lucro_liquido
    };
}

app.get("/operacoes-antecipacao/:id/repasse/preview", async (req, res) => {
    try {
        const previa = await calcularPreviaRepasse(req.params.id);

        if (!previa) {
            return res.status(404).json({
                erro: "Operação não encontrada."
            });
        }

        res.json(previa);
    } catch (erro) {
        console.error("Erro ao calcular prévia do repasse:", erro);
        res.status(500).json({
            erro: "Erro ao calcular a prévia do repasse."
        });
    }
});

app.get("/operacoes-antecipacao/:id/repasse", async (req, res) => {
    try {
        const operacao = await dbGet(
            "SELECT id FROM operacoes_antecipacao WHERE id = ?",
            [req.params.id]
        );

        if (!operacao) {
            return res.status(404).json({
                erro: "Operação não encontrada."
            });
        }

        const repasse = await dbGet(
            "SELECT * FROM repasses WHERE operacao_id = ?",
            [req.params.id]
        );

        if (!repasse) {
            return res.status(404).json({
                erro: "Esta operação ainda não teve o repasse confirmado."
            });
        }

        res.json(repasse);
    } catch (erro) {
        console.error("Erro ao buscar repasse:", erro);
        res.status(500).json({
            erro: "Erro ao buscar o repasse."
        });
    }
});

app.post("/operacoes-antecipacao/:id/repasse", async (req, res) => {
    const { id } = req.params;
    const {
        data_pagamento,
        usuario,
        banco,
        forma_pagamento,
        numero_comprovante,
        observacoes
    } = req.body;

    if (!forma_pagamento || !FORMAS_PAGAMENTO_REPASSE.includes(forma_pagamento)) {
        return res.status(400).json({
            erro: `Informe uma forma de pagamento válida. Use uma de: ${FORMAS_PAGAMENTO_REPASSE.join(", ")}.`
        });
    }

    try {
        const operacao = await dbGet(
            `SELECT o.*, ${SUBQUERIES_TOTAIS_OPERACAO} FROM operacoes_antecipacao o WHERE o.id = ?`,
            [id]
        );

        if (!operacao) {
            return res.status(404).json({
                erro: "Operação não encontrada."
            });
        }

        // Checa duplicidade antes do status: se já existe repasse, essa é
        // a causa real (a operação virou Ativa exatamente por causa dele)
        // — sem essa ordem, uma segunda tentativa cairia sempre no erro
        // genérico de status errado, escondendo a causa específica.
        const repasseExistente = await dbGet(
            "SELECT id FROM repasses WHERE operacao_id = ?",
            [id]
        );

        if (repasseExistente) {
            return res.status(409).json({
                erro: "Esta operação já teve o repasse confirmado."
            });
        }

        if (operacao.status !== "Aprovada") {
            return res.status(400).json({
                erro: `A operação precisa estar Aprovada para confirmar o repasse (status atual: "${operacao.status}").`
            });
        }

        const comSaldo = comSaldoOperacao(operacao);

        if (comSaldo.valor_face <= 0) {
            return res.status(400).json({
                erro:
                    "Esta operação não possui notas fiscais ativas — cadastre ao menos uma antes de confirmar o repasse."
            });
        }

        const dataFinal = data_pagamento || obterHojeISO();
        const horaFinal = new Date().toLocaleTimeString("pt-BR");
        const agora = obterDataHoraCriacaoBrasilia();

        const resultado = await dbRun(
            `
            INSERT INTO repasses (
                operacao_id, valor_face, desagio, custos_cedente, valor_liquido,
                lucro_bruto, lucro_liquido_previsto, data_pagamento, hora_pagamento,
                usuario, banco, forma_pagamento, numero_comprovante, observacoes,
                criado_em
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                id,
                comSaldo.valor_face,
                comSaldo.lucro_bruto,
                comSaldo.total_custos_cedente_pagos,
                comSaldo.valor_liquido_repasse,
                comSaldo.lucro_bruto,
                comSaldo.lucro_liquido,
                dataFinal,
                horaFinal,
                usuario || null,
                banco || null,
                forma_pagamento,
                numero_comprovante || null,
                observacoes || null,
                agora
            ]
        );

        await dbRun(
            `UPDATE operacoes_antecipacao SET status = 'Ativa', atualizado_em = ? WHERE id = ?`,
            [agora, id]
        );

        const repasse = await dbGet(
            "SELECT * FROM repasses WHERE id = ?",
            [resultado.lastID]
        );

        const operacaoAtualizada = await dbGet(
            `
            SELECT
                o.*,
                e.razao_social AS empresa_razao_social,
                e.nome_fantasia AS empresa_nome_fantasia,
                e.cnpj AS empresa_cnpj,
                ${SUBQUERIES_TOTAIS_OPERACAO}
            FROM operacoes_antecipacao o
            INNER JOIN empresas_cedentes e ON e.id = o.empresa_cedente_id
            WHERE o.id = ?
            `,
            [id]
        );

        registrarMovimentacaoNF(
            id,
            "Repasse Confirmado",
            `Repasse confirmado via ${forma_pagamento}${banco ? ` (banco: ${banco})` : ""}. Valor líquido: R$ ${comSaldo.valor_liquido_repasse.toFixed(2)}.`,
            comSaldo.valor_liquido_repasse,
            usuario || null
        );

        res.json({
            mensagem: "Repasse confirmado com sucesso! A operação está Ativa.",
            repasse,
            operacao: comSaldoOperacao(operacaoAtualizada)
        });
    } catch (erro) {
        console.error("Erro ao confirmar repasse:", erro);

        if (String(erro.message || "").includes("UNIQUE")) {
            return res.status(409).json({
                erro: "Esta operação já teve o repasse confirmado."
            });
        }

        res.status(500).json({
            erro: "Erro ao confirmar o repasse."
        });
    }
});

app.get("/operacoes-antecipacao/:id/linha-tempo", async (req, res) => {
    const { id } = req.params;

    try {
        const operacao = await dbGet(
            "SELECT id FROM operacoes_antecipacao WHERE id = ?",
            [id]
        );

        if (!operacao) {
            return res.status(404).json({
                erro: "Operação não encontrada."
            });
        }

        const eventos = await dbAll(
            `
            SELECT id, operacao_id, data, hora, tipo, descricao, valor, usuario, criado_em
            FROM movimentacoes_nf
            WHERE operacao_id = ?
            ORDER BY data ASC, hora ASC, id ASC
            `,
            [id]
        );

        res.json(eventos);
    } catch (erro) {
        console.error("Erro ao buscar linha do tempo da operação:", erro);
        res.status(500).json({
            erro: "Erro ao buscar a linha do tempo da operação."
        });
    }
});

app.listen(3001, () => {
    console.log("Servidor rodando na porta 3001");
});