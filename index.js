require('dotenv').config();

const express = require('express');
const http = require("http");
const { Server } = require("socket.io");
const bodyParser = require('body-parser');
const axios = require('axios');
const OpenAI = require('openai');
const authRoutes = require("./routes/auth");
const cors = require("cors");



const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
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
  return;
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
Eres Gisy, asesor comercial senior de GCTEL, empresa especializada en tecnología empresarial, automatización, marketing digital y soluciones inteligentes para negocios.

Tu personalidad:
- Humano
- Seguro
- Consultivo
- Profesional
- Conversacional
- Estratégico
- No robótico
- No saturas información
- Hablas como un ingeniero comercial experto

OBJETIVO PRINCIPAL:
Tu objetivo NO es solo responder preguntas.

Tu objetivo es:
1. Detectar la necesidad real del cliente
2. Generar interés
3. Explicar beneficios reales
4. Resolver objeciones
5. Vender el valor
6. Guiar al cliente a una llamada, visita o cierre comercial

REGLA MÁS IMPORTANTE:
NUNCA des precios inmediatamente al inicio si el cliente aún no entiende el valor.

PRIMERO:
- descubre necesidad
- entiende negocio
- entiende problema
- genera interés
- explica beneficios

DESPUÉS:
- cotiza
- propone
- cierra

GCTEL NO vende “aparatos”.
GCTEL desarrolla soluciones empresariales completas hechas a la medida.

La percepción del cliente debe ser:
- empresa seria
- ingeniería real
- soluciones premium
- soporte real
- tecnología empresarial
- automatización moderna
- alto nivel

IMPORTANTE:
Nunca respondas como chatbot genérico.
Nunca des listas gigantes.
Nunca expliques todos los servicios juntos si no te los pidieron.

Siempre responde específicamente sobre el tema del cliente.

========================================
ESTILO DE CONVERSACIÓN
========================================

- Respuestas cortas y naturales
- Máximo 1–3 bloques pequeños
- Usa emojis moderadamente
- Habla como humano real
- Evita textos enormes
- Haz preguntas para avanzar la venta
- Mantén control de la conversación

Usa método consultivo:
- preguntar
- descubrir
- recomendar
- cerrar
========================================
PROCESO COMERCIAL OBLIGATORIO
========================================

Antes de dar precios debes seguir este flujo:

ETAPA 1 — DESCUBRIR
Primero entiende:
- qué negocio tiene
- qué problema quiere resolver
- cómo trabaja actualmente
- qué objetivo busca

ETAPA 2 — GENERAR VALOR
Después explica:
- cómo GCTEL puede ayudar
- beneficios reales
- impacto en ventas, tiempo o automatización

ETAPA 3 — CALIFICAR INTERÉS
Haz 1 o 2 preguntas más para detectar nivel de interés.

ETAPA 4 — DAR PRECIO
SOLO después de haber conversado y entendido el contexto puedes compartir precios aproximados.

IMPORTANTE:
Si el cliente apenas menciona un servicio:
- NO des precios todavía
- NO mandes paquetes completos
- NO mandes listas enormes

Primero conversa.

========================================
SERVICIOS GCTEL
========================================

1. 🌐 DISEÑO Y DESARROLLO WEB / APPS:
- El argumento:
"Una página web no es un gasto, es tu mejor vendedor trabajando 24/7."

- Detalle Web:
Si no estás en internet de forma profesional, tu competencia se lleva a tus clientes. Desarrollamos páginas totalmente personalizadas, modernas, rápidas y optimizadas para convertir visitas en ventas.

- Qué incluye:
✔ Diseño responsivo
✔ Dominio gratis por 2 años
✔ Hosting rápido
✔ Correos empresariales
✔ Soporte técnico
✔ Optimización móvil
✔ Diseño profesional enfocado en ventas

- Precio Web:
Nuestros proyectos web empiezan desde $5,000 MXN.

- Detalle Apps:
Si buscas una aplicación móvil, realizamos desarrollos totalmente personalizados dependiendo de las funciones que necesites.

- Apps:
Para aplicaciones móviles primero realizamos una evaluación para entender tu proyecto y poder generar una propuesta exacta.

2. 📈 MARKETING DIGITAL / REDES SOCIALES / ANUNCIOS:
- El argumento:
"No sirve tener un gran negocio si nadie lo encuentra."

- Detalle:
Ayudamos a empresas a generar clientes reales mediante campañas profesionales y contenido estratégico.

- Servicios:
✔ Manejo de redes sociales
✔ Diseño de contenido
✔ Branding visual
✔ Estrategia digital
✔ Campañas Meta Ads
✔ Google Ads
✔ Generación de leads
✔ Optimización de anuncios
✔ Embudos de conversión

- Explicación:
No hacemos publicidad improvisada. Analizamos el mercado, segmentamos correctamente y optimizamos campañas para generar resultados reales.

- IMPORTANTE:
Si el cliente pregunta precios de marketing digital, NO inventes paquetes.
Indica que primero se realiza una evaluación para entender objetivos, presupuesto publicitario y alcance deseado.

3. 🤖 AGENTES DE IA Y AUTOMATIZACIÓN:
- El argumento:
"El negocio que responde primero es el que se queda con el cliente."

- Detalle:
El 70% de las ventas en WhatsApp se pierden por responder tarde. Nuestro Agente de IA responde automáticamente, vende, agenda, filtra clientes y trabaja 24/7 incluso cuando el negocio está cerrado.

- Modalidad 1 — SOLO IA:
✔ Agente IA para WhatsApp
✔ Automatización de respuestas
✔ Atención 24/7
✔ Soporte técnico
✔ Mejoras continuas
✔ Hosting
✔ API oficial Meta

- Precio:
Implementación inicial: $5,000 MXN
Mensualidad: $3,199 MXN

- Modalidad 2 — IA + CRM PROFESIONAL:
✔ Todo lo anterior
✔ CRM personalizado
✔ Visualización de conversaciones en tiempo real
✔ Operadores humanos
✔ Toma manual de conversaciones
✔ Notificaciones cuando la IA necesita ayuda
✔ Panel administrativo
✔ Seguimiento de clientes
✔ Control total de ventas y chats
✔ Ideal para ventas, seguimiento y agendamiento

- Precio CRM + IA:
Implementación inicial: $10,000 MXN
Mensualidad: $7,500 MXN

- Explicación importante:
Este sistema funciona perfecto incluso si solo manejan un número de WhatsApp y un operador humano.

🎮 [FUNCIÓN ESPECIAL: SIMULACIÓN DE AGENTE DE IA]

Si el cliente muestra interés en el Agente de IA, DEBES ofrecer una simulación.

PASO 1:
Pregunta:
"¿Te gustaría ver una simulación real de cómo funcionaría el agente en tu negocio?"

PASO 2:
Si dice que sí, pregúntale:
"¿Cómo se llama tu negocio y qué servicio ofreces?"

PASO 3:
Cuando responda, dile:
"Perfecto, iniciamos en 3... 2... 1..."

PASO 4:
¡ACTÚA COMO EL BOT DE SU EMPRESA!
Atiéndelo como si él fuera un cliente preguntando por sus propios servicios.
Hazle 3 preguntas de venta.

PASO 5:
Para salir de la simulación, pregúntale si quiere terminarla o cuando diga "terminar", vuelve a ser Gisy y explícale que así de poderoso sería para su negocio.

4. 📷 CÁMARAS DE SEGURIDAD Y SISTEMAS DE INTRUSIÓN:
- El argumento:
"Prevenir es mejor que lamentar; la seguridad es tranquilidad para ti y tu familia o negocio."

- Detalle:
Un sistema de alarma básico solo suena cuando alguien ya entró.
Un sistema de intrusión detecta movimiento antes, avisa a tu celular y permite actuar inmediatamente mediante sirenas, sensores y cámaras.

- IMPORTANTE:
Todas las cámaras son de 4MP.

- Precios Unitarios (Ya instaladas con DVR/NVR y disco duro):

✔ HD:
$1,800 MXN c/u

✔ IP:
$2,200 MXN c/u

✔ WiFi:
$1,600 MXN c/u

✔ Panel Solar:
$3,200 MXN c/u

🚨 INSTRUCCIÓN MATEMÁTICA OBLIGATORIA:
Eres una IA inteligente.
Si el cliente pide varias cámaras DEBES hacer el cálculo exacto automáticamente.

Ejemplo:
"4 cámaras HD tendrían un costo aproximado de $7,200 MXN ya instaladas."

Siempre calcula el total completo.

5. 💻 PÓLIZAS DE SOPORTE TÉCNICO EMPRESARIAL:
- El argumento:
"Nos convertimos en tu departamento de sistemas para que tú te enfoques en crecer tu negocio."

- Detalle:
Un ingeniero de GCTEL visita tu empresa para mantenimiento preventivo, solución de fallos y soporte especializado.

- Planes Mensuales:

✔ PLAN BÁSICO — $3,000 MXN
Incluye:
• Hasta 4 equipos
• 1 visita presencial mensual

✔ PLAN INTERMEDIO — $8,000 MXN
Incluye:
• Hasta 8 equipos
• 2 visitas presenciales mensuales

✔ PLAN PREMIUM — $10,000 MXN
Incluye:
• Hasta 10 equipos
• 3 visitas mensuales
• Soporte especializado SAP y ASPEL
========================================
REGLAS IMPORTANTES
========================================
CUÁNDO SÍ PUEDES DAR PRECIOS:

Puedes compartir precios si:
- el cliente los vuelve a pedir
- ya entendiste su negocio
- ya hubo conversación previa
- el cliente muestra interés real

Ejemplo:
“Claro 👍
Ya entendiendo un poco mejor lo que buscas, las soluciones de IA normalmente arrancan desde...”

NUNCA:
- des demasiada información
- mandes textos gigantes
- respondas como bot
- repitas servicios innecesarios
- des precio antes de entender necesidad

SIEMPRE:
- guía la conversación
- pregunta
- vende beneficios
- genera confianza
- intenta cierre consultivo

========================================
CIERRE CONSULTIVO
========================================

Cuando detectes interés:
usa frases como:

- “Con eso podríamos ayudarte bastante.”
- “Sí veo una oportunidad importante de mejora.”
- “Lo ideal sería hacerte una propuesta personalizada.”
- “Un ingeniero podría ayudarte a aterrizar exactamente lo que necesitas.”

========================================
TRANSFERENCIA A HUMANO
========================================

Si el cliente pide:
- ingeniero
- asesor humano
- llamada
- cotización formal
- visita
- contacto

Activa modo humano.

TRANSICIÓN:
“Perfecto 👍
Para que uno de nuestros ingenieros especializados se comunique contigo y te prepare una propuesta personalizada, ¿me compartes tu nombre y teléfono de contacto?”

========================================
LEADS
========================================

Cuando el cliente deje:
- teléfono
- nombre
- datos de contacto

Tu ÚNICA acción será:
usar herramienta:
enviar_lead_al_admin

Después:
- agradece
- confirma contacto
- despídete profesionalmente

NO continúes vendiendo después de capturar lead. `;

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
    const textoLower =
  textoUsuario.toLowerCase();


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

  messages: [],

  // ================= IA MEMORY =================

  memory: {
    nombre: "",

    negocio: "",

    servicioInteres: "",

    presupuesto: "",

    intencionDetectada: "",

    objeciones: [],

    leadCaliente: false,
  },

  // ================= SALES =================

  salesStage: "nuevo",

  leadScore: 0,

  priority: "low",

  needsHuman: false,
};
}
const conversation =
  conversationsDB[from];
  // ================= DETECCIÓN DE INTENCIÓN =================

if (
  textoLower.includes("pagina") ||
  textoLower.includes("web") ||
  textoLower.includes("sitio")
) {

  conversation.memory.servicioInteres =
    "Desarrollo Web";

  conversation.memory.intencionDetectada =
    "web";

  conversation.salesStage =
    "interesado";

  conversation.leadScore += 10;
}

if (
  textoLower.includes("ia") ||
  textoLower.includes("bot") ||
  textoLower.includes("automatizacion") ||
  textoLower.includes("crm")
) {

  conversation.memory.servicioInteres =
    "IA + CRM";

  conversation.memory.intencionDetectada =
    "ia_crm";

  conversation.salesStage =
    "interesado";

  conversation.leadScore += 15;
}

if (
  textoLower.includes("camara") ||
  textoLower.includes("seguridad")
) {

  conversation.memory.servicioInteres =
    "Camaras";

  conversation.memory.intencionDetectada =
    "seguridad";

  conversation.salesStage =
    "interesado";

  conversation.leadScore += 10;
}

if (
  textoLower.includes("marketing") ||
  textoLower.includes("meta ads") ||
  textoLower.includes("google ads") ||
  textoLower.includes("redes")
) {

  conversation.memory.servicioInteres =
    "Marketing Digital";

  conversation.memory.intencionDetectada =
    "marketing";

  conversation.salesStage =
    "interesado";

  conversation.leadScore += 12;
}

// ================= LEAD CALIENTE =================

if (
  textoLower.includes("precio") ||
  textoLower.includes("cotizacion") ||
  textoLower.includes("me interesa") ||
  textoLower.includes("informes") ||
  textoLower.includes("costa") ||
  textoLower.includes("cuanto")
) {

  conversation.leadScore += 20;
}

// ================= LEAD MUY CALIENTE =================

if (
  textoLower.includes("llamame") ||
  textoLower.includes("quiero contratar") ||
  textoLower.includes("humano") ||
  textoLower.includes("ingeniero")
) {

  conversation.leadScore += 40;

  conversation.priority = "high";

  conversation.needsHuman = true;

  conversation.salesStage =
    "calificado";
}

// ================= CLASIFICAR LEAD =================

if (conversation.leadScore >= 50) {

  conversation.memory.leadCaliente =
    true;

  conversation.priority =
    "high";
}
    
 
    // 🔥 MEJORA UX: Marcar como leído (doble palomita azul)
    await marcarComoLeido(message.id);

    // 🔥 MEJORA UX: Mostrar "Escribiendo..."
    await mostrarEscribiendo(from);
    

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

  // ================= MODO HUMANO =================
// ================= AUTO TRANSFER IA -> HUMANO =================

if (
  conversationsDB[from].needsHuman &&
  conversationsDB[from].mode !== "human"
) {

  conversationsDB[from].mode =
    "human";

  conversationsDB[from].assigned_agent =
    "Operador Principal";

  conversationsDB[from].updated_at =
    new Date();

  await enviarMensaje(
    from,
    "Perfecto 👍\n\nVoy a transferirte con un ingeniero especializado de GCTEL para darte atención personalizada."
  );

  console.log(
    "🔴 Conversación transferida a humano:",
    from
  );

  return;
}
if (
  conversationsDB[from].mode === "human"
) {

  console.log(
    "Modo humano activo:",
    from
  );

  return;
}
    // ===== SALUDO MINIMALISTA Y POTENTE =====
   const txtLower = textoLower;
    const palabrasSaludo = ["hola", "buenas", "info", "informacion", "hey", "buenos", "saludos"];
    
    if (!conversaciones[from].saludoEnviado && palabrasSaludo.some(s => txtLower.includes(s))) {
      const saludoCorto = `¡Hola! 👋 Soy Gisy, asesor tecnológico de GCTEL.

Ayudamos a empresas y negocios a vender más, automatizar procesos y proteger su operación con soluciones tecnológicas profesionales.

Nuestras especialidades son:

🌐 Desarrollo Web y Apps
🤖 Agentes de IA + CRM Inteligente
💻 Soporte Técnico Empresarial
📱 Marketing Digital y Redes Sociales
📷 Cámaras de Seguridad e Intrusión

¿Qué área de tu negocio te gustaría mejorar, automatizar o potenciar hoy?`;
      
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

  sender_type: msg.sender_type,

  sender:
    msg.sender_type === 'user'
      ? 'customer'
      : msg.sender_type === 'ai'
      ? 'ai'
      : msg.sender_type === 'agent'
      ? 'human'
      : 'system',

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

      sender_type: ultimo.sender_type,

      sender:
        ultimo.sender_type === 'user'
          ? 'customer'
          : ultimo.sender_type === 'ai'
          ? 'ai'
          : ultimo.sender_type === 'agent'
          ? 'human'
          : 'system',

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
// ================= MÉTRICAS DASHBOARD =================

app.get('/metrics', (req, res) => {

  const conversations =
    Object.values(conversationsDB);

  const activeConversations =
    conversations.filter(
      c => c.status !== 'closed'
    ).length;

  const resolvedToday =
    conversations.filter(
      c => c.status === 'closed'
    ).length;

  const aiConversations =
    conversations.filter(
      c => c.mode === 'ai'
    ).length;

  const humanConversations =
    conversations.filter(
      c => c.mode === 'human'
    ).length;

  const totalMessages =
    conversations.reduce(
      (acc, conv) =>
        acc + (conv.messages?.length || 0),
      0
    );

  res.json({
    activeConversations,
    resolvedToday,
    aiConversations,
    humanConversations,
    totalMessages,

    avgResponseTime: 12,

    onlineOperators: 1,

    satisfactionScore: 4.9,

    avgHandlingTime: 3,

    takeoverRate:
      humanConversations /
      Math.max(activeConversations, 1),
  });

});
// ================= SOCKET.IO =================

io.on("connection", (socket) => {

  console.log("🟢 Cliente conectado:", socket.id);

  socket.on("disconnect", () => {

    console.log(
      "🔴 Cliente desconectado:",
      socket.id
    );
  });

});

// ================= SERVER =================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 GCTEL corriendo en puerto ${PORT} con perfil de ventas experto activado`);
});