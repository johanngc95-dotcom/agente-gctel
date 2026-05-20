require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const OpenAI = require('openai');
const authRoutes = require("./routes/auth");
const cors = require("cors");


const app = express();
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());
app.use('/auth', authRoutes);


// 🔥 Memoria en sesión (Guarda el contexto de los clientes)
const conversaciones = {};
// ================= CRM MEMORY DATABASE =================
const conversationsDB = {};
// 🔥 OpenAI Setup
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ================= RUTA PRINCIPAL =================
app.get('/', (req, res) => {
  res.send("🤖 GCTEL funcionando en la nube con mejoras UX y de IA.");
});

// ================= VERIFICACIÓN DE META =================
app.get('/webhook', (req, res) => {
  const verify_token = process.env.VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === verify_token) {
      console.log("Webhook verificado ✅");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

// ================= CRM ENDPOINTS =================

// OBTENER TODAS LAS CONVERSACIONES
app.get('/conversations', (req, res) => {
  const conversations = Object.values(conversationsDB);

  res.json(conversations);
});

// OBTENER MENSAJES DE UNA CONVERSACIÓN
app.get('/messages/:conversationId', (req, res) => {
  const { conversationId } = req.params;

  const conversation =
    conversationsDB[conversationId];

  if (!conversation) {
    return res.status(404).json({
      error: 'Conversación no encontrada',
    });
  }

  res.json(conversation.messages);
});

// CAMBIAR MODO IA / HUMANO
app.post('/conversation/mode', (req, res) => {
  const { conversationId, mode } = req.body;

  if (!conversationsDB[conversationId]) {
    return res.status(404).json({
      error: 'Conversación no encontrada',
    });
  }

  conversationsDB[conversationId].mode = mode;

  res.json({
    success: true,
    mode
  });
});

// RESPUESTA HUMANA DESDE CRM
app.post('/agent/reply', async (req, res) => {
  try {

    const {
      conversationId,
      message,
      agentName
    } = req.body;

    const conversation =
      conversationsDB[conversationId];

    if (!conversation) {
      return res.status(404).json({
        error: "Conversación no encontrada"
      });
    }

    // Guardar mensaje operador
    conversation.messages.push({
      id: Date.now().toString(),
      sender_type: "agent",
      content: message,
      timestamp: new Date(),
      agent: agentName
    });

    conversation.updated_at = new Date();

    // Enviar WhatsApp
    await enviarMensaje(
      conversationId,
      message
    );

    res.json({
      success: true
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Error enviando mensaje"
    });
  }
});

// CERRAR CONVERSACIÓN
app.post('/conversation/close', (req, res) => {

  const { conversationId } = req.body;

  if (!conversationsDB[conversationId]) {
    return res.status(404).json({
      error: 'Conversación no encontrada',
    });
  }

  conversationsDB[conversationId].status =
    "closed";

  res.json({
    success: true
  });
});

// ================= FUNCIONES DE EXPERIENCIA (UX) =================

async function enviarMensaje(to, mensaje) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: { body: mensaje }
      },
      {
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
      }
    );
  } catch (error) {
    console.error("Error al enviar mensaje:", error.response?.data || error.message);
  }
}

async function marcarComoLeido(messageId) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId
      },
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
    );
  } catch (error) {} // Silenciar errores menores
}

async function mostrarEscribiendo(to) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: to,
        action: "typing_on"
      },
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
    );
  } catch (error) {}
}

// ================= IA Y PROMPT =================
function guardarConversacion(phone, name, message, fromMe = false) {

  if (!global.crmConversations) {
    global.crmConversations = [];
  }

  let existing = global.crmConversations.find(
    (c) => c.phone === phone
  );

  const newMessage = {
    id: Date.now().toString(),
    content: message,
    timestamp: new Date().toISOString(),
    sender: fromMe ? "agent" : "customer",
  };

  if (existing) {

    existing.messages.push(newMessage);

    existing.lastMessage = newMessage;

    existing.updatedAt =
      new Date().toISOString();

    existing.lastActivity =
      new Date().toISOString();

    if (!fromMe) {
      existing.unreadCount += 1;
    }

    return;
  }

  global.crmConversations.unshift({
    id: Date.now().toString(),

    phone,

    customer: {
      name: name || phone,
      phone,
      avatar: "",
    },

    messages: [newMessage],

    lastMessage: newMessage,

    unreadCount: fromMe ? 0 : 1,

    status: "open",

    mode: "ai",

    priority: "medium",

    createdAt: new Date().toISOString(),

    updatedAt: new Date().toISOString(),

    lastActivity: new Date().toISOString(),
  });
}
async function respuestaIA(from, historial) {
  const tools = [
    {
      type: "function",
      function: {
        name: "enviar_lead_al_admin",
        description: "Llama a esta función EXACTAMENTE CUANDO el cliente proporcione su teléfono de contacto y nombre para contratar un servicio, recibir cotización o agendar visita.",
        parameters: {
          type: "object",
          properties: {
            nombre: { type: "string", description: "Nombre del cliente" },
            telefono: { type: "string", description: "Teléfono de contacto del cliente" },
            empresa_o_giro: { type: "string", description: "Nombre de su empresa o a qué se dedica" },
            servicio_interes: { type: "string", description: "El servicio de GCTEL que le interesa" }
          },
          required: ["telefono", "servicio_interes"]
        }
      }
    }
  ];

  const systemPrompt = `
Eres Gisy, asesor comercial EXPERTO de GCTEL, una empresa líder en tecnologia de la informacion y soluciones inovadoras para empresas y hogares.

OBJETIVO PRINCIPAL:
VENDER el valor de GCTEL. Eres un experto consultivo. Debes detectar la necesidad del cliente, explicar A DETALLE por qué nuestro servicio es su mejor opción y guiarlo a dejar sus datos para un cierre comercial.

¿POR QUÉ GCTEL ES LA MEJOR OPCIÓN? (Inyecta esta confianza en tus respuestas):
No somos improvisados ni vendemos "aparatos sueltos". Somos una empresa de ingenieros especializados. Ofrecemos "trajes a la medida", soporte real, instalaciones estéticas y funcionales, y acompañamiento empresarial. Con nosotros, el cliente invierte en soluciones que le generan dinero (ventas) o le ahorran problemas (seguridad y soporte).

SERVICIOS CLAVE Y CÓMO VENDERLOS (Explica a detalle cuando te pregunten):

1. 🌐 DISEÑO Y DESARROLLO WEB / APPS:
- El argumento: "Una página web no es un gasto, es tu mejor vendedor trabajando 24/7". 
- Detalle Web: Si no estás en internet de forma profesional, tu competencia se lleva a tus clientes. Hacemos la página 100% a la medida, podemos desarrollar prácticamente cualquier diseño o idea que tengas en mente. 
- Precio Web: Nuestros precios empiezan desde $5,000 MXN. ¡Es un paquete súper completo! Esto ya te incluye: Soporte técnico, Dominio gratis por 2 años, Hosting (alojamiento rápido), Correo institucional y diseño que se adapta a celulares.
- Detalle Apps: Si buscas una Aplicación Móvil, los precios varían. Necesitamos agendar una evaluación para entender exactamente qué funciones requieres y armarte una cotización precisa.

2. 🤖 AGENTES DE IA (AUTOMATIZACIÓN):
- El argumento: "El negocio que responde primero es el que se queda con el cliente".
- Detalle: El 70% de las ventas en WhatsApp se pierden por responder tarde. Este Agente de IA (como yo) entiende, vende, califica y agenda citas automáticamente 24/7.
- Precios: Implementación inicial $5,000 MXN. Mensualidad $3,199 MXN.
- ¿Qué incluye la mensualidad?: Para que no te preocupes por nada, esto ya cubre el soporte técnico, mejoras continuas a la IA, el alojamiento del agente en la nube, y lo más importante: los costos de conexión a la API oficial de Meta.

🎮 [FUNCIÓN ESPECIAL: SIMULACIÓN DE AGENTE DE IA]
Si el cliente muestra interés en el Agente de IA, DEBES ofrecer una simulación.
PASO 1: Pregunta: "¿Te gustaría ver una simulación real de cómo funcionaría el agente en tu negocio?".
PASO 2: Si dice que sí, pregúntale: "¿Cómo se llama tu negocio y qué servicio ofreces?".
PASO 3: Cuando responda, dile: "Perfecto, iniciamos en 3... 2... 1...".
PASO 4: ¡ACTÚA COMO EL BOT DE SU EMPRESA! Atiéndelo como si él fuera un cliente preguntando por sus propios servicios. Hazle 3 preguntas de venta.
PASO 5: Para salir de la simulación, pregúntale si quiere terminarla o cuando diga "terminar", vuelve a ser Gisy y explícale que así de poderoso sería para su negocio.

3. 📷 CÁMARAS DE SEGURIDAD Y SISTEMAS DE INTRUSIÓN:
- El argumento: "Prevenir es mejor que lamentar; la seguridad es tranquilidad para ti y tu familia/negocio".
- Detalle: "Un sistema de ALARMA básico solo suena cuando alguien ya entró. Un sistema de INTRUSIÓN detecta el movimiento antes, avisa a tu celular y permite actuar con sirenas y cámaras".
- Precios Unitarios (Ya instaladas con NVR/DVR y disco duro):
  * HD: $1,800 MXN c/u.
  * IP: $2,200 MXN c/u.
  * WiFi: $1,600 MXN c/u.
  * Panel Solar: $3,200 MXN c/u.
- 🚨 INSTRUCCIÓN MATEMÁTICA OBLIGATORIA: Eres una IA inteligente. Si el cliente pide un paquete de varias cámaras, HAZ LA SUMA O MULTIPLICACIÓN EXACTA. Ejemplo: Si pide 4 cámaras HD, debes responderle: "Un paquete de 4 cámaras HD tendría un costo aproximado de $7,200 MXN ya instaladas". Siempre hazle el cálculo total. las camaras son de 4mp

4. 💻 PÓLIZAS DE SOPORTE TÉCNICO EMPRESARIAL:
- El argumento: "Nos convertimos en tu área de sistemas externa para que tú te enfoques en hacer crecer tu negocio".
- Detalle: Un ingeniero de GCTEL va a tu oficina a dar mantenimiento y resolver fallos para que tu operación nunca se detenga. 
- Planes Mensuales:
  * PLAN BÁSICO ($3,000 MXN): Incluye hasta 4 equipos y 1 visita presencial al mes del técnico.
  * PLAN INTERMEDIO ($8,000 MXN): Incluye hasta 8 equipos y 2 visitas presenciales al mes.
  * PLAN PREMIUM ($10,000 MXN): Incluye hasta 10 equipos, 3 visitas al mes, y el gran diferenciador estrella: Soporte técnico especializado en sistemas SAP o ASPEL.

REGLAS DE COMUNICACIÓN:
1. Tono humano, experto y seguro. Habla como un consultor senior.
2. NUNCA satures de información de golpe. Si preguntan por cámaras, háblales SOLO de cámaras, no menciones las páginas web.
3. Método Socrático: Cierra tus mensajes con una pregunta para avanzar (Ej. "¿Cuántos equipos de cómputo manejas en tu oficina?", "¿Tu negocio ya cuenta con página web?").
4. Cierre: Cuando notes que el cliente está listo para una cotización o visita, usa la transición: "Para que un ingeniero experto se ponga en contacto contigo y te envíe una propuesta exacta, ¿me podrías compartir tu nombre y un teléfono de contacto?".

INSTRUCCIÓN ESPECIAL SOBRE DATOS (LEADS):
En el momento en el que el cliente escriba su teléfono de contacto o acepte ser contactado dejando sus datos, tu ÚNICA acción debe ser usar la herramienta 'enviar_lead_al_admin'. NO SIGAS VENDIENDO DESPUÉS DE ESTO. Agradece, indícale que un ingeniero le llamará, y despídete amablemente.
  `;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      ...historial
    ],
    tools: tools,
    tool_choice: "auto",
  });

  const responseMessage = completion.choices[0].message;

  // 🔥 AQUÍ OCURRE LA MAGIA DEL LEAD 🔥
  if (responseMessage.tool_calls) {
    const args = JSON.parse(responseMessage.tool_calls[0].function.arguments);
    
    // Armar el mensaje para ti (El administrador)
    const numeroAdmin = "525572322336"; 
    const alertaLead = `🚨 *¡NUEVO LEAD DE GISY!* 🚨\n\n👤 *Nombre:* ${args.nombre || 'No especificó'}\n🏢 *Negocio:* ${args.empresa_o_giro || 'No especificó'}\n📲 *Teléfono:* ${args.telefono}\n💡 *Interés:* ${args.servicio_interes}\n\n🔗 *Chat:* https://wa.me/${args.telefono}`;
    
    await enviarMensaje(numeroAdmin, alertaLead);

    // Mensaje final para el cliente
    return "¡Perfecto! Ya tengo tus datos a salvo. 📝\n\nUn ingeniero especializado de GCTEL se pondrá en contacto contigo muy pronto a ese número para darte atención personalizada y afinar los detalles. ¿Hay algo más en lo que te pueda ayudar por ahora?";
  }

  return responseMessage.content;
}

// ================= WEBHOOK PRINCIPAL =================
app.post('/webhook', async (req, res) => {
  // META EXIGE EL 200 OK INMEDIATO. Lo enviamos antes de procesar nada para evitar bucles.
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value?.messages) return; // Si no hay mensaje, salimos.

    const message = value.messages[0];
    const from = message.from;

    // 🔥 MEJORA DE ERRORES: Validar que sea texto
    if (message.type !== "text") {
      await enviarMensaje(from, "Disculpa, por ahora solo puedo entender mensajes de texto escritos. ¿Podrías escribirme tu consulta? ✍️");
      return;
    }

    const textoUsuario = message.text.body;
    // ================= CREAR CONVERSACIÓN CRM =================

if (!conversationsDB[from]) {

  conversationsDB[from] = {
    id: from,
    phone: from,
    name: from,
    mode: "ai",
    status: "open",
    assigned_agent: null,
    created_at: new Date(),
    updated_at: new Date(),
    messages: []
  };
}
    
 
    // 🔥 MEJORA UX: Marcar como leído (doble palomita azul)
    await marcarComoLeido(message.id);

    // 🔥 MEJORA UX: Mostrar "Escribiendo..."
    await mostrarEscribiendo(from);
    // ================= MODO HUMANO =================

if (
  conversationsDB[from].mode === "human"
) {
  return;
}

    // ===== INICIALIZAR MEMORIA =====
    if (!conversaciones[from]) {
  conversaciones[from] = {
    saludoEnviado: false,
    historial: []
  };
}


// ================= GUARDAR MENSAJE USUARIO =================

conversationsDB[from].messages.push({
  id: Date.now().toString(),
  sender_type: "user",
  content: textoUsuario,
  timestamp: new Date()
});

conversationsDB[from].updated_at =
  new Date();

    // ===== SALUDO MINIMALISTA Y POTENTE =====
    const txtLower = textoUsuario.toLowerCase();
    const palabrasSaludo = ["hola", "buenas", "info", "informacion", "hey", "buenos", "saludos"];
    
    if (!conversaciones[from].saludoEnviado && palabrasSaludo.some(s => txtLower.includes(s))) {
      const saludoCorto = `¡Hola! 👋 Soy Gisy, asesor tecnológico de GCTEL.\n\nAyudamos a potenciar y proteger tu negocio con soluciones a la medida. Nuestras especialidades son:\n\n🌐 Diseño Web y Apps (Tu vendedor 24/7)\n🤖 Agentes de IA (Automatización de ventas)\n📷 Cámaras de Seguridad (Alarmas vs Intrusión)\n💻 Soporte Empresarial (Tu área de sistemas externa, SAP/ASPEL)\n\n¿Qué área de tu negocio te gustaría mejorar, automatizar o proteger hoy?`;
      
      await enviarMensaje(from, saludoCorto);
      conversaciones[from].saludoEnviado = true;
      
      // Guardar el saludo en el historial para que la IA sepa qué dijo
      conversaciones[from].historial.push({ role: "user", content: textoUsuario });
      conversaciones[from].historial.push({ role: "assistant", content: saludoCorto });
      return;
    }

    // ===== HISTORIAL Y LLAMADA A IA =====
    conversaciones[from].historial.push({
      role: "user",
      content: textoUsuario
    });

    // Limitar historial para no gastar de más en OpenAI (Guarda solo los últimos 15 mensajes)
    if (conversaciones[from].historial.length > 15) {
      conversaciones[from].historial = conversaciones[from].historial.slice(-15);
    }

    const respuesta = await respuestaIA(from, conversaciones[from].historial);

    conversaciones[from].historial.push({
      role: "assistant",
      content: respuesta
    });

    // ================= GUARDAR RESPUESTA IA =================

conversationsDB[from].messages.push({
  id: Date.now().toString(),
  sender_type: "ai",
  content: respuesta,
  timestamp: new Date()
});

conversationsDB[from].updated_at =
  new Date();

    await enviarMensaje(from, respuesta);
  } catch (error) {
    console.error("ERROR GRAVE:", error);
    // Si OpenAI falla o hay un error raro, Gisy no se queda callado.
    if (req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
      const fallbackTo = req.body.entry[0].changes[0].value.messages[0].from;
      await enviarMensaje(fallbackTo, "Dame un segundo, estoy consultando con los ingenieros la mejor opción para ti... ⏳");
    }
  }
});

// ================= CRM CONVERSATIONS API =================

app.get('/conversations', (req, res) => {

  const conversaciones = Object.values(
    conversationsDB
  ).map((conv) => {

    const mensajes = conv.messages || [];

    const ultimo =
      mensajes[mensajes.length - 1];

    return {

      id: conv.id,

      customer: {
        name: conv.phone,
        phone: conv.phone,
        avatar: '',
      },

      messages: mensajes.map((msg) => ({
        id: msg.id,

        content: msg.content,

        sender:
          msg.sender_type === 'user'
            ? 'customer'
            : 'agent',

        timestamp: new Date(
          msg.timestamp
        ).toISOString(),

        type: 'text',

        status: 'delivered',
      })),

      lastMessage: ultimo
        ? {
            id: ultimo.id,
            content: ultimo.content,

            sender:
              ultimo.sender_type === 'user'
                ? 'customer'
                : 'agent',

            timestamp: new Date(
              ultimo.timestamp
            ).toISOString(),

            type: 'text',

            status: 'delivered',
          }
        : null,

      unreadCount: 0,

      mode: conv.mode || 'ai',

      status: conv.status || 'open',

      priority: 'medium',

      tags: ['whatsapp'],

      createdAt: new Date(
        conv.created_at
      ).toISOString(),

      updatedAt: new Date(
        conv.updated_at
      ).toISOString(),

      lastActivity: new Date(
        conv.updated_at
      ).toISOString(),
    };
  });

  res.json(conversaciones);

});

// ================= SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 GCTEL corriendo en puerto ${PORT} con perfil de ventas experto activado`);
});