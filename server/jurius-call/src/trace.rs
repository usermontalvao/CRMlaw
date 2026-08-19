//! O que o serviço REALMENTE põe no fio quando o assunto é chamada.
//!
//! POR QUE ISTO EXISTE. A chamada de vídeo de saída é aceita pelo servidor (o
//! relay sobe), mas o aparelho do contato não responde nada — nem `preaccept`,
//! nem `reject`, nem `terminate` — enquanto a MESMA chamada em voz faz o
//! telefone tocar. Com os dois lados fechados (o CRM manda `video=true`, o
//! `place_call` anexa o `VideoSource` antes do `.start()`), o que sobra para
//! olhar é a stanza, e ela é montada dentro da biblioteca.
//!
//! A biblioteca tem exatamente a torneira para isso: `Event::SentFrame` entrega
//! o texto marshalado de cada quadro que o transporte aceitou. A torneira é
//! FECHADA por padrão e abre com uma lease (`acquire_sent_frame_forwarding`,
//! em `main`) — sem ela nada é emitido e nada é clonado.
//!
//! O QUE SAI NO LOG, e o que NÃO sai. Só stanza `<call>`: mensagem de conversa
//! passa por aqui e não pode ir parar no log do container. Dentro dela, o
//! `<enc>` (a chave da chamada, cifrada por dispositivo) e o
//! `<device-identity>` viram só o TAMANHO; JID vira `***`. A `capability` sai
//! inteira em hexa de propósito: são os 7 bytes que distinguem uma oferta de
//! áudio (`…bb…`) de uma de vídeo (`…fa…`), e é justamente o que precisa ser
//! comparado com uma captura do cliente oficial.
use std::sync::Arc;

use log::info;
use wacore::types::events::{Event, EventHandler, EventInterest, EventKind};
use whatsapp_rust::wacore_binary::marshal::unmarshal_packed_ref;
use whatsapp_rust::wacore_binary::node::ValueRef;
use whatsapp_rust::wacore_binary::NodeRef;

/// Atributos cujo valor NUNCA vai para o log: são o telefone/JID do contato.
const MASCARAR: [&str; 5] = ["to", "from", "jid", "call-creator", "caller_pn"];

pub struct SentCallTrace;

impl EventHandler for SentCallTrace {
    fn interest(&self) -> EventInterest {
        EventInterest::of(&[EventKind::SentFrame])
    }

    fn handle_event(&self, event: Arc<Event>) {
        let Event::SentFrame(frame) = &*event else {
            return;
        };
        // O byte de formato vai junto no `plaintext`; é este `unmarshal` que o
        // confere em vez de assumir.
        let Ok(node) = unmarshal_packed_ref(&frame.plaintext) else {
            return;
        };
        if &*node.tag != "call" {
            return;
        }
        info!("stanza enviada: {}", descrever(&node));
    }
}

/// UMA LINHA por stanza, e não uma árvore indentada.
///
/// A árvore era mais bonita de ler e impossível de colher: o visualizador de
/// log do Portainer busca por linha e o copiar/colar corta o começo do bloco —
/// a primeira tentativa de captura chegou aqui sem o `<call>` e sem os
/// `<audio>`, que é metade do que se queria comparar.
fn descrever(call: &NodeRef<'_>) -> String {
    let mut saida = format!("call({})", atributos(call));
    for acao in call.children().unwrap_or_default() {
        saida.push_str(&format!(" {}({})", &*acao.tag, atributos(acao)));
        // A ORDEM dos filhos é o que interessa: o servidor recusa o `<offer>`
        // com 439 quando ela sai errada, e a posição do `<video>` é justamente
        // o ponto que o upstream marca como não validado.
        let filhos = acao
            .children()
            .unwrap_or_default()
            .iter()
            .map(|filho| format!("{}[{}]", &*filho.tag, detalhe(filho)))
            .collect::<Vec<_>>();
        if !filhos.is_empty() {
            saida.push_str(&format!(" :: {}", filhos.join(" | ")));
        }
    }
    saida
}

fn atributos(no: &NodeRef<'_>) -> String {
    no.attrs_iter()
        .map(|(chave, valor)| {
            let nome = &**chave;
            if MASCARAR.contains(&nome) {
                return format!("{nome}=***");
            }
            match valor {
                ValueRef::String(texto) => format!("{nome}={}", &**texto),
                // JID em qualquer atributo é endereço de gente.
                ValueRef::Jid(_) => format!("{nome}=***"),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn detalhe(no: &NodeRef<'_>) -> String {
    let attrs = atributos(no);
    match no.content_bytes() {
        Some(bytes) if &*no.tag == "capability" => format!("{attrs} = {}", hexa(bytes)),
        Some(bytes) => format!("{attrs} ({} bytes)", bytes.len()),
        None => match no.children() {
            // Quantos `<to>` há dentro do `<destination>` é quantos aparelhos do
            // contato a oferta endereça. Um `<enc>` solto no lugar dele é UM
            // aparelho só — e essa contagem é parte da comparação voz x vídeo.
            Some(filhos) if !filhos.is_empty() => {
                let tags = filhos
                    .iter()
                    .map(|f| f.tag.to_string())
                    .collect::<Vec<_>>()
                    .join(",");
                format!("{attrs} {{{tags}}}")
            }
            _ => attrs,
        },
    }
}

fn hexa(bytes: &[u8]) -> String {
    let mut saida = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        saida.push_str(&format!("{byte:02x}"));
    }
    saida
}
