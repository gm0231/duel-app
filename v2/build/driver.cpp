// Minimal embedding driver for edo9300/ygopro-core (OCG API v11) for the WASM PoC.
// Exposes a registry-based card/script supply and a simple duel control surface to JS.
#include "ocgapi.h"
#include <cstdint>
#include <cstring>
#include <map>
#include <string>
#include <vector>
#include <emscripten/emscripten.h>

struct CardEntry {
    OCG_CardData data{};
    std::vector<uint16_t> setcodes; // 0-terminated
};
static std::map<uint32_t, CardEntry> g_cards;
static std::map<std::string, std::string> g_scripts;
static const uint8_t* g_msg_ptr = nullptr;
static uint32_t g_msg_len = 0;
static uint8_t g_scratch[8192];

static void cardReader(void* /*payload*/, uint32_t code, OCG_CardData* data) {
    auto it = g_cards.find(code);
    if (it == g_cards.end()) {
        std::memset(data, 0, sizeof(*data));
        data->code = code;
        return;
    }
    *data = it->second.data;
    data->setcodes = it->second.setcodes.empty() ? nullptr : it->second.setcodes.data();
}
static void cardReaderDone(void* /*payload*/, OCG_CardData* data) {
    data->setcodes = nullptr;
}
static int scriptReader(void* /*payload*/, OCG_Duel duel, const char* name) {
    std::string key = name ? name : "";
    auto it = g_scripts.find(key);
    if (it == g_scripts.end()) {
        auto pos = key.find_last_of('/');
        if (pos != std::string::npos) it = g_scripts.find(key.substr(pos + 1));
    }
    if (it == g_scripts.end()) return 0;
    return OCG_LoadScript(duel, it->second.data(), static_cast<uint32_t>(it->second.size()), name);
}
static void logHandler(void* /*payload*/, const char* str, int type) {
    std::fprintf(stderr, "[ocgcore log type=%d] %s\n", type, str ? str : "");
}

extern "C" {

EMSCRIPTEN_KEEPALIVE void poc_register_card(uint32_t code, uint32_t alias, const char* setcodes_csv,
                                            uint32_t type, uint32_t level, uint32_t attribute,
                                            uint32_t race_lo, uint32_t race_hi, int32_t atk, int32_t def,
                                            uint32_t lscale, uint32_t rscale, uint32_t link_marker) {
    CardEntry e;
    e.data.code = code;
    e.data.alias = alias;
    e.data.type = type;
    e.data.level = level;
    e.data.attribute = attribute;
    e.data.race = (static_cast<uint64_t>(race_hi) << 32) | race_lo;
    e.data.attack = atk;
    e.data.defense = def;
    e.data.lscale = lscale;
    e.data.rscale = rscale;
    e.data.link_marker = link_marker;
    if (setcodes_csv && *setcodes_csv) {
        std::string s = setcodes_csv;
        size_t start = 0;
        while (start < s.size()) {
            auto pos = s.find(',', start);
            auto tok = s.substr(start, pos == std::string::npos ? pos : pos - start);
            if (!tok.empty()) e.setcodes.push_back(static_cast<uint16_t>(std::stoul(tok, nullptr, 0)));
            if (pos == std::string::npos) break;
            start = pos + 1;
        }
    }
    e.setcodes.push_back(0);
    e.data.setcodes = e.setcodes.data();
    g_cards[code] = std::move(e);
}

EMSCRIPTEN_KEEPALIVE void poc_register_script(const char* name, const char* text) {
    g_scripts[name] = text;
}
EMSCRIPTEN_KEEPALIVE void poc_register_script_buf(const char* name, const uint8_t* text, uint32_t len) {
    g_scripts[name] = std::string(reinterpret_cast<const char*>(text), len);
}

EMSCRIPTEN_KEEPALIVE int poc_load_global(OCG_Duel duel, const char* name) {
    auto it = g_scripts.find(name);
    if (it == g_scripts.end()) return -1;
    return OCG_LoadScript(duel, it->second.data(), static_cast<uint32_t>(it->second.size()), name);
}

EMSCRIPTEN_KEEPALIVE OCG_Duel poc_create(uint32_t seed, uint64_t flags, uint32_t lp,
                                         uint32_t start_draw, uint32_t draw_per_turn) {
    OCG_DuelOptions opts{};
    opts.seed[0] = seed ? seed : 12345;
    opts.seed[1] = 67890;
    opts.seed[2] = 24680;
    opts.seed[3] = 13579;
    opts.flags = flags;
    opts.team1 = {lp, start_draw, draw_per_turn};
    opts.team2 = {lp, start_draw, draw_per_turn};
    opts.cardReader = cardReader;
    opts.scriptReader = scriptReader;
    opts.logHandler = logHandler;
    opts.cardReaderDone = cardReaderDone;
    opts.enableUnsafeLibraries = 0;
    OCG_Duel duel = nullptr;
    int status = OCG_CreateDuel(&duel, &opts);
    if (status != 0) {
        std::fprintf(stderr, "[poc] OCG_CreateDuel failed: %d\n", status);
        return nullptr;
    }
    return duel;
}

EMSCRIPTEN_KEEPALIVE void poc_new_card(OCG_Duel duel, uint32_t team, uint32_t duelist, uint32_t code,
                                       uint32_t con, uint32_t loc, uint32_t seq, uint32_t pos) {
    OCG_NewCardInfo info{};
    info.team = static_cast<uint8_t>(team);
    info.duelist = static_cast<uint8_t>(duelist);
    info.code = code;
    info.con = static_cast<uint8_t>(con);
    info.loc = loc;
    info.seq = seq;
    info.pos = pos;
    OCG_DuelNewCard(duel, &info);
}

EMSCRIPTEN_KEEPALIVE void poc_start(OCG_Duel duel) { OCG_StartDuel(duel); }

// Returns duel status (0=END,1=AWAITING,2=CONTINUE); messages stashed for poc_msg_*.
EMSCRIPTEN_KEEPALIVE int poc_process(OCG_Duel duel) {
    int status = OCG_DuelProcess(duel);
    uint32_t len = 0;
    void* buf = OCG_DuelGetMessage(duel, &len);
    g_msg_ptr = static_cast<const uint8_t*>(buf);
    g_msg_len = len;
    return status;
}
EMSCRIPTEN_KEEPALIVE const uint8_t* poc_msg_ptr() { return g_msg_ptr; }
EMSCRIPTEN_KEEPALIVE uint32_t poc_msg_len() { return g_msg_len; }
EMSCRIPTEN_KEEPALIVE uint8_t* poc_scratch() { return g_scratch; }
EMSCRIPTEN_KEEPALIVE void poc_respond(OCG_Duel duel, uint32_t len) {
    if (len <= sizeof(g_scratch)) OCG_DuelSetResponse(duel, g_scratch, len);
}
EMSCRIPTEN_KEEPALIVE void poc_destroy(OCG_Duel duel) { OCG_DestroyDuel(duel); }

// Live card query (Phase 2): wraps OCG_DuelQuery for a single card slot and
// stashes the result buffer (the core's query_buffer, valid until the next
// query/process call) for poc_query_ptr()/poc_query_len().
static const uint8_t* g_query_ptr = nullptr;
static uint32_t g_query_len = 0;
EMSCRIPTEN_KEEPALIVE uint32_t poc_query_card(OCG_Duel duel, uint32_t flags, uint32_t con, uint32_t loc, uint32_t seq) {
    OCG_QueryInfo info{};
    info.flags = flags;
    info.con = static_cast<uint8_t>(con);
    info.loc = loc;
    info.seq = seq;
    info.overlay_seq = 0;
    uint32_t len = 0;
    void* buf = OCG_DuelQuery(duel, &len, &info);
    g_query_ptr = static_cast<const uint8_t*>(buf);
    g_query_len = len;
    return len;
}
EMSCRIPTEN_KEEPALIVE const uint8_t* poc_query_ptr() { return g_query_ptr; }
EMSCRIPTEN_KEEPALIVE uint32_t poc_query_len() { return g_query_len; }

} // extern "C"
