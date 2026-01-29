/**
 * MESSAGE PARSER UTILITY
 * ====================================
 * Funciones puras para analizar y extraer información de mensajes de WhatsApp.
 * No tiene dependencias de base de datos ni efectos secundarios.
 */

/**
 * Desempaqueta mensajes de wrappers como ephemeralMessage, viewOnceMessage, etc.
 * WhatsApp a veces envuelve mensajes en múltiples capas de encriptación/protección.
 * 
 * @param message - Objeto de mensaje de Baileys
 * @returns Mensaje real desempaquetado (sin wrappers)
 * 
 * @example
 * const realMsg = getRealMessage(message.ephemeralMessage);
 * // Retorna el mensaje interno sin la capa ephemeral
 */
export function getRealMessage(message: any): any {
    if (!message) return undefined;

    // Mensaje efímero (desaparece después de verse)
    if (message.ephemeralMessage) {
        return getRealMessage(message.ephemeralMessage.message);
    }

    // Mensajes "Ver una vez" (diferentes versiones)
    if (message.viewOnceMessage) {
        return getRealMessage(message.viewOnceMessage.message);
    }
    if (message.viewOnceMessageV2) {
        return getRealMessage(message.viewOnceMessageV2.message);
    }
    if (message.viewOnceMessageV2Extension) {
        return getRealMessage(message.viewOnceMessageV2Extension.message);
    }

    // Mensaje enviado desde otro dispositivo vinculado
    if (message.deviceSentMessage) {
        return getRealMessage(message.deviceSentMessage.message);
    }

    return message;
}

/**
 * Extrae el texto completo de un mensaje de WhatsApp.
 * Maneja diferentes tipos de mensajes que pueden contener texto.
 * 
 * @param message - Objeto de mensaje de Baileys
 * @returns Texto del mensaje o undefined si no tiene texto
 * 
 * @example
 * const text = extractMessageText(message);
 * console.log(text); // "Hola, ¿cómo estás?"
 */
export function extractMessageText(message: any): string | undefined {
    const realMessage = getRealMessage(message);
    if (!realMessage) return undefined;

    // ──────────────────────────────────────
    // 📝 TEXTOS SIMPLES
    // ──────────────────────────────────────

    // Mensaje de texto plano
    if (realMessage.conversation && realMessage.conversation !== '[Media]') {
        return realMessage.conversation;
    }

    // Texto con formato (negrita, cursiva, links, menciones)
    if (realMessage.extendedTextMessage?.text) {
        return realMessage.extendedTextMessage.text;
    }

    // ──────────────────────────────────────
    // 🖼️ CAPTIONS DE MULTIMEDIA
    // ──────────────────────────────────────

    if (realMessage.imageMessage?.caption) {
        return realMessage.imageMessage.caption;
    }

    if (realMessage.videoMessage?.caption) {
        return realMessage.videoMessage.caption;
    }

    if (realMessage.documentMessage?.caption) {
        return realMessage.documentMessage.caption;
    }

    // ──────────────────────────────────────
    // 🔘 RESPUESTAS DE BOTONES E INTERACCIONES
    // ──────────────────────────────────────

    // Respuesta a botones normales
    if (realMessage.buttonsResponseMessage?.selectedButtonId) {
        const displayText = realMessage.buttonsResponseMessage.selectedDisplayText;
        const buttonId = realMessage.buttonsResponseMessage.selectedButtonId;
        return `Botón: ${displayText || buttonId}`;
    }

    // Respuesta a listas desplegables
    if (realMessage.listResponseMessage?.singleSelectReply?.selectedRowId) {
        const title = realMessage.listResponseMessage.title;
        const rowId = realMessage.listResponseMessage.singleSelectReply.selectedRowId;
        return `Lista: ${title || rowId}`;
    }

    // Respuesta a botones de plantilla
    if (realMessage.templateButtonReplyMessage?.selectedId) {
        const displayText = realMessage.templateButtonReplyMessage.selectedDisplayText;
        const selectedId = realMessage.templateButtonReplyMessage.selectedId;
        return `Botón: ${displayText || selectedId}`;
    }

    // ──────────────────────────────────────
    // 📍 TIPOS ESPECIALES
    // ──────────────────────────────────────

    // Ubicación compartida
    if (realMessage.locationMessage) {
        const lat = realMessage.locationMessage.degreesLatitude;
        const lng = realMessage.locationMessage.degreesLongitude;
        return `📍 Ubicación: ${lat}, ${lng}`;
    }

    // Contacto compartido
    if (realMessage.contactMessage) {
        const name = realMessage.contactMessage.displayName || 'Sin nombre';
        return `👤 Contacto: ${name}`;
    }

    // Múltiples contactos
    if (realMessage.contactsArrayMessage) {
        const count = realMessage.contactsArrayMessage.contacts?.length || 0;
        return `👥 ${count} contacto(s)`;
    }

    // Reacción a mensaje (emoji)
    if (realMessage.reactionMessage) {
        return `${realMessage.reactionMessage.text} (reacción)`;
    }

    // Encuesta/Poll
    if (realMessage.pollCreationMessage) {
        return `📊 Encuesta: ${realMessage.pollCreationMessage.name}`;
    }

    // Sticker
    if (realMessage.stickerMessage) {
        return '🎨 Sticker';
    }

    return undefined;
}

/**
 * Detecta el tipo de mensaje de forma precisa.
 * Analiza tanto los wrappers como el contenido interno.
 * 
 * @param message - Objeto de mensaje de Baileys
 * @returns Tipo de mensaje en formato legible (string)
 * 
 * @example
 * const type = detectMessageType(message);
 * console.log(type); // "image" | "video" | "view_once_image" | "text" | etc.
 */
export function detectMessageType(message: any): string {
    if (!message) return 'text';

    // ──────────────────────────────────────
    // 🔐 DETECTAR "VER UNA VEZ" (Prioridad alta)
    // ──────────────────────────────────────

    const isViewOnce =
        message.viewOnceMessage ||
        message.viewOnceMessageV2 ||
        message.viewOnceMessageV2Extension ||
        message.ephemeralMessage?.message?.viewOnceMessage ||
        message.ephemeralMessage?.message?.viewOnceMessageV2;

    const realMessage = getRealMessage(message);
    if (!realMessage) return 'text';

    // Si es "ver una vez", detectar si es imagen o video
    if (isViewOnce) {
        if (realMessage.imageMessage) return 'view_once_image';
        if (realMessage.videoMessage) return 'view_once_video';
    }

    // ──────────────────────────────────────
    // 📋 TIPOS DE CONTENIDO
    // ──────────────────────────────────────

    if (realMessage.conversation || realMessage.extendedTextMessage) {
        return 'text';
    }

    if (realMessage.imageMessage) {
        return 'image';
    }

    if (realMessage.videoMessage) {
        return 'video';
    }

    // Audio vs Nota de voz (se diferencian por la propiedad 'ptt')
    if (realMessage.audioMessage) {
        return realMessage.audioMessage.ptt ? 'voice' : 'audio';
    }

    if (realMessage.documentMessage) {
        return 'document';
    }

    if (realMessage.stickerMessage) {
        return 'sticker';
    }

    if (realMessage.locationMessage || realMessage.liveLocationMessage) {
        return 'location';
    }

    if (realMessage.contactMessage) {
        return 'contact';
    }

    if (realMessage.contactsArrayMessage) {
        return 'contacts';
    }

    if (realMessage.buttonsResponseMessage || realMessage.templateButtonReplyMessage) {
        return 'button_reply';
    }

    if (realMessage.listResponseMessage) {
        return 'list_reply';
    }

    if (realMessage.reactionMessage) {
        return 'reaction';
    }

    if (realMessage.pollCreationMessage) {
        return 'poll';
    }

    if (realMessage.pollUpdateMessage) {
        return 'poll_update';
    }

    // ──────────────────────────────────────
    // ❓ FALLBACK INTELIGENTE
    // ──────────────────────────────────────

    const keys = Object.keys(realMessage);
    if (keys.length > 0) {
        const key = keys[0];

        // Intento de detectar "ver una vez" si todo lo demás falla
        if (key.includes('ViewOnce') || key.includes('viewOnce')) {
            return 'view_once_image';
        }

        // Extraer tipo del nombre de la key (ej: "imageMessage" -> "image")
        return key.replace('Message', '').toLowerCase();
    }

    return 'unknown';
}

/**
 * Verifica si un mensaje es de tipo "Ver una vez"
 * basándose en la metadata de la key del mensaje.
 * 
 * @param messageKey - key del mensaje de Baileys
 * @returns true si es "ver una vez", false si no
 */
export function isViewOnceMessage(messageKey: any): boolean {
    return (messageKey as any)?.isViewOnce || false;
}
