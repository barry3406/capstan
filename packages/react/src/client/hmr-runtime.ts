// Client-side HMR runtime for Capstan.
//
// This module is consumed in two ways:
// 1. As an importable module for advanced consumers (`createHmrRuntime`)
// 2. As an inline `<script>` generator (`buildHmrClientScript`) injected by
//    the dev server into every HTML page.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HmrUpdate {
  type:
    | "css"
    | "page"
    | "layout"
    | "api"
    | "middleware"
    | "loading"
    | "error"
    | "config"
    | "full-reload";
  filePath: string;
  timestamp: number;
}

export interface HmrRuntimeConfig {
  /** Server protocol. Default: "sse" */
  protocol?: "ws" | "sse";
  /** Reconnect delay ms. Default: 1000 */
  reconnectDelay?: number;
  /** Max reconnect attempts. Default: 10 */
  maxReconnectAttempts?: number;
}

export interface HmrRuntimeHandle {
  connect(url: string): void;
  disconnect(): void;
  onUpdate(handler: (update: HmrUpdate) => void): () => void;
}

// ---------------------------------------------------------------------------
// Runtime (importable)
// ---------------------------------------------------------------------------

export function createHmrRuntime(
  config?: HmrRuntimeConfig,
): HmrRuntimeHandle {
  const protocol = config?.protocol ?? "sse";
  const reconnectDelay = config?.reconnectDelay ?? 1000;
  const maxAttempts = config?.maxReconnectAttempts ?? 10;

  const handlers = new Set<(update: HmrUpdate) => void>();
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let manuallyDisconnected = false;
  let connection: { close: () => void } | null = null;

  function emit(update: HmrUpdate): void {
    for (const handler of handlers) {
      try {
        handler(update);
      } catch {
        /* consumer error — don't break other handlers */
      }
    }
  }

  function scheduleReconnect(url: string): void {
    if (manuallyDisconnected || attempts >= maxAttempts) return;
    const delay = reconnectDelay * Math.pow(2, attempts);
    attempts++;
    timer = setTimeout(() => connectInternal(url), delay);
  }

  function connectInternal(url: string): void {
    if (manuallyDisconnected) return;

    if (protocol === "ws") {
      const ws = new WebSocket(url);
      connection = ws;

      ws.onopen = () => {
        attempts = 0;
      };

      ws.onmessage = (e) => {
        try {
          const update = JSON.parse(e.data as string) as HmrUpdate;
          emit(update);
        } catch {
          /* malformed message */
        }
      };

      ws.onclose = () => {
        connection = null;
        scheduleReconnect(url);
      };

      ws.onerror = () => {
        ws.close();
      };
    } else {
      const es = new EventSource(url);
      connection = es;

      es.onopen = () => {
        attempts = 0;
      };

      es.onmessage = (e) => {
        try {
          const update = JSON.parse(e.data as string) as HmrUpdate;
          emit(update);
        } catch {
          /* malformed message */
        }
      };

      es.onerror = () => {
        es.close();
        connection = null;
        scheduleReconnect(url);
      };
    }
  }

  return {
    connect(url: string): void {
      manuallyDisconnected = false;
      attempts = 0;
      connectInternal(url);
    },

    disconnect(): void {
      manuallyDisconnected = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (connection) {
        connection.close();
        connection = null;
      }
    },

    onUpdate(handler: (update: HmrUpdate) => void): () => void {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Inline script builder
// ---------------------------------------------------------------------------

/**
 * Escape a value for safe embedding inside a JavaScript string literal
 * placed within an HTML `<script>` tag.
 */
function escapeForScript(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

/**
 * Build an inline `<script>` that the dev server injects into HTML pages.
 * This is the replacement for the old `LIVE_RELOAD_SCRIPT`.
 */
export function buildHmrClientScript(options: {
  port: number;
  hostname?: string;
  protocol?: "ws" | "sse";
}): string {
  const protocol = options.protocol ?? "sse";
  const hostname = escapeForScript(options.hostname ?? "localhost");
  const port = Number(options.port);

  if (protocol === "ws") {
    return [
      "<script>",
      "(function(){",
      `  var url='ws://${hostname}:${port}/__capstan_hmr';`,
      "  var attempts=0,maxAttempts=10,delay=1000,timer=null,overlay=null;",
      "  function showOverlay(){",
      "    if(overlay)return;",
      "    overlay=document.createElement('div');",
      "    overlay.id='__capstan_hmr_overlay';",
      "    overlay.style.cssText='position:fixed;bottom:16px;right:16px;background:rgba(0,0,0,0.8);color:#fff;padding:8px 16px;border-radius:6px;font:13px/1.4 system-ui,sans-serif;z-index:2147483647;pointer-events:none;';",
      "    overlay.textContent='Reconnecting...';",
      "    document.body.appendChild(overlay);",
      "  }",
      "  function hideOverlay(){",
      "    if(overlay){overlay.remove();overlay=null;}",
      "  }",
      "  function connect(){",
      "    var ws=new WebSocket(url);",
      "    ws.onopen=function(){attempts=0;hideOverlay();};",
      "    ws.onmessage=function(e){",
      "      try{var u=JSON.parse(e.data);handleUpdate(u);}catch(err){}",
      "    };",
      "    ws.onclose=function(){reconnect();};",
      "    ws.onerror=function(){ws.close();};",
      "  }",
      "  function reconnect(){",
      "    if(attempts>=maxAttempts)return;",
      "    showOverlay();",
      "    var d=delay*Math.pow(2,attempts);",
      "    attempts++;",
      "    timer=setTimeout(connect,d);",
      "  }",
      "  function handleUpdate(u){",
      "    if(u.type==='css'){if(!hotSwapCSS(u.filePath,u.timestamp))location.reload();}",
      "    else if(u.type==='page'||u.type==='layout'||u.type==='loading'||u.type==='error'){",
      "      if(window.__CAPSTAN_ROUTER__&&window.__CAPSTAN_ROUTER__.navigate){",
      "        window.__CAPSTAN_ROUTER__.navigate(location.href,{noCache:true});",
      "      }else{location.reload();}",
      "    }",
      "    else if(u.type==='api'||u.type==='middleware'){/* server-only */}",
      "    else{location.reload();}",
      "  }",
      "  function hotSwapCSS(filePath,ts){",
      "    var links=document.querySelectorAll('link[rel=\"stylesheet\"]');",
      "    var normalised=filePath.replace(/\\\\/g,'/');",
      "    var found=false;",
      "    for(var i=0;i<links.length;i++){",
      "      var link=links[i];",
      "      var href=link.getAttribute('href')||'';",
      "      var bare=href.split('?')[0].split('#')[0];",
      "      if(bare===normalised||bare.endsWith('/'+normalised)||normalised.endsWith(bare)){",
      "        var hash=href.indexOf('#')!==-1?href.slice(href.indexOf('#')):'';",
      "        link.setAttribute('href',bare+'?t='+ts+hash);",
      "        found=true;",
      "      }",
      "    }",
      "    return found;",
      "  }",
      "  connect();",
      "})();",
      "</script>",
    ].join("\n");
  }

  // SSE (default)
  return [
    "<script>",
    "(function(){",
    `  var url='/__capstan_hmr';`,
    "  var attempts=0,maxAttempts=10,delay=1000,timer=null,overlay=null,disconnected=false,es=null;",
    "  function showOverlay(){",
    "    if(overlay)return;",
    "    overlay=document.createElement('div');",
    "    overlay.id='__capstan_hmr_overlay';",
    "    overlay.style.cssText='position:fixed;bottom:16px;right:16px;background:rgba(0,0,0,0.8);color:#fff;padding:8px 16px;border-radius:6px;font:13px/1.4 system-ui,sans-serif;z-index:2147483647;pointer-events:none;';",
    "    overlay.textContent='Reconnecting...';",
    "    document.body.appendChild(overlay);",
    "  }",
    "  function hideOverlay(){",
    "    if(overlay){overlay.remove();overlay=null;}",
    "  }",
    "  function connect(){",
    "    if(disconnected)return;",
    "    es=new EventSource(url);",
    "    es.onopen=function(){attempts=0;hideOverlay();};",
    "    es.onmessage=function(e){",
    "      try{var u=JSON.parse(e.data);handleUpdate(u);}catch(err){}",
    "    };",
    "    es.onerror=function(){",
    "      es.close();",
    "      reconnect();",
    "    };",
    "  }",
    "  function reconnect(){",
    "    if(disconnected||attempts>=maxAttempts)return;",
    "    showOverlay();",
    "    var d=delay*Math.pow(2,attempts);",
    "    attempts++;",
    "    timer=setTimeout(connect,d);",
    "  }",
    "  function handleUpdate(u){",
    "    if(u.type==='css'){if(!hotSwapCSS(u.filePath,u.timestamp))location.reload();}",
    "    else if(u.type==='page'||u.type==='layout'||u.type==='loading'||u.type==='error'){",
    "      if(window.__CAPSTAN_ROUTER__&&window.__CAPSTAN_ROUTER__.navigate){",
    "        window.__CAPSTAN_ROUTER__.navigate(location.href,{noCache:true});",
    "      }else{location.reload();}",
    "    }",
    "    else if(u.type==='api'||u.type==='middleware'){/* server-only */}",
    "    else{location.reload();}",
    "  }",
    "  function hotSwapCSS(filePath,ts){",
    "    var links=document.querySelectorAll('link[rel=\"stylesheet\"]');",
    "    var normalised=filePath.replace(/\\\\/g,'/');",
    "    var found=false;",
    "    for(var i=0;i<links.length;i++){",
    "      var link=links[i];",
    "      var href=link.getAttribute('href')||'';",
    "      var bare=href.split('?')[0].split('#')[0];",
    "      if(bare===normalised||bare.endsWith('/'+normalised)||normalised.endsWith(bare)){",
    "        var hash=href.indexOf('#')!==-1?href.slice(href.indexOf('#')):'';",
    "        link.setAttribute('href',bare+'?t='+ts+hash);",
    "        found=true;",
    "      }",
    "    }",
    "    return found;",
    "  }",
    "  connect();",
    "})();",
    "</script>",
  ].join("\n");
}
