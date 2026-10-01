<script setup lang="ts">
/**
 * The three conversations between a Breeze client and a Breeze .NET server, for the home page.
 *
 * Two drawings of the same thing: a wide one, client on the left and server on the right with a
 * lane per conversation, and a stacked one for phones, where the wide one's text would be too
 * small to read. CSS shows one or the other. Colours come from the VitePress theme variables, so
 * both follow light and dark mode.
 */
const lanes = [
  {
    n: 1, name: 'Metadata',
    client: ['Metadata store', 'types, keys, relationships'],
    request: 'GET …/Metadata',
    response: 'the model, as JSON',
    server: ['Metadata()', 'read from your mapping'],
    sql: false,
    short: { client: 'Metadata store', server: 'Metadata()', serverIsCode: true, request: 'GET …/Metadata', response: 'the model' },
  },
  {
    n: 2, name: 'Query',
    client: ['Entity cache', 'merges what comes back'],
    request: 'GET …/Customers?{ query }',
    response: 'entities, as JSON',
    server: ['[BreezeQueryFilter]', 'runs it on IQueryable'],
    sql: true,
    short: { client: 'Entity cache', server: 'Query filter', serverIsCode: false, request: 'GET …/Customers?{…}', response: 'entities' },
  },
  {
    n: 3, name: 'Save',
    client: ['Change tracking', 'added, modified, deleted'],
    request: 'POST …/SaveChanges',
    response: 'saved entities + real keys',
    server: ['SaveChanges()', 'one transaction'],
    sql: true,
    short: { client: 'Change tracking', server: 'SaveChanges()', serverIsCode: true, request: 'POST …/SaveChanges', response: 'entities + keys' },
  },
];

// Wide drawing: lane centres, and where the arrows start and end.
const laneY = [170, 275, 380];
const wireFrom = 202;   // right edge of a client row
const wireTo = 627;     // left edge of a server row

// Stacked drawing: one card per lane.
const cardTop = (i: number) => 34 + i * 104;
</script>

<template>
  <figure class="cs-diagram">
    <!-- Wide -->
    <svg class="cs-wide" viewBox="0 0 900 440" role="img"
         aria-labelledby="cs-wide-title cs-wide-desc">
      <title id="cs-wide-title">How a Breeze client talks to a Breeze .NET server</title>
      <desc id="cs-wide-desc">
        Three exchanges over HTTP and JSON. Metadata: the client gets the model, which the server
        reads from its mapping. Query: the client sends a query, the server runs it on IQueryable
        as SQL, and the entities come back into the client's cache. Save: the client sends its
        tracked changes as one change-set, the server saves them in one transaction and returns
        the saved entities and their real keys.
      </desc>

      <!-- Client -->
      <rect class="zone" x="1" y="1" width="228" height="438" rx="14" />
      <text class="zone-label" x="16" y="26">Browser</text>
      <rect class="app" x="16" y="40" width="198" height="44" rx="8" />
      <text class="title" x="115" y="59" text-anchor="middle">Your app</text>
      <text class="sub" x="115" y="75" text-anchor="middle">Angular · React · Vue · …</text>
      <rect class="lib" x="16" y="100" width="198" height="324" rx="10" />
      <text class="lib-label" x="28" y="122">breeze-client · EntityManager</text>
      <g v-for="(lane, i) in lanes" :key="'c' + lane.n">
        <rect class="row" x="28" :y="laneY[i] - 29" width="174" height="58" rx="7" />
        <text class="title" x="115" :y="laneY[i] - 4" text-anchor="middle">{{ lane.client[0] }}</text>
        <text class="sub" x="115" :y="laneY[i] + 14" text-anchor="middle">{{ lane.client[1] }}</text>
      </g>

      <!-- Server -->
      <rect class="zone" x="600" y="1" width="200" height="438" rx="14" />
      <text class="zone-label" x="615" y="26">ASP.NET Core server</text>
      <rect class="app" x="615" y="40" width="170" height="44" rx="8" />
      <text class="title" x="700" y="59" text-anchor="middle">Your controller</text>
      <text class="sub" x="700" y="75" text-anchor="middle">one per data service</text>
      <rect class="lib" x="615" y="100" width="170" height="324" rx="10" />
      <text class="lib-label" x="627" y="122">Breeze .NET server</text>
      <g v-for="(lane, i) in lanes" :key="'s' + lane.n">
        <rect class="row" x="627" :y="laneY[i] - 29" width="146" height="58" rx="7" />
        <text class="title mono" x="700" :y="laneY[i] - 4" text-anchor="middle">{{ lane.server[0] }}</text>
        <text class="sub" x="700" :y="laneY[i] + 14" text-anchor="middle">{{ lane.server[1] }}</text>
      </g>

      <!-- ORM and database -->
      <text class="sub strong" x="851" y="214" text-anchor="middle">EF Core or</text>
      <text class="sub strong" x="851" y="230" text-anchor="middle">NHibernate</text>
      <path class="db" d="M813 255 a38 9 0 0 0 76 0 v140 a38 9 0 0 1 -76 0 Z" />
      <ellipse class="db" cx="851" cy="255" rx="38" ry="9" />
      <text class="title" x="851" y="335" text-anchor="middle">Database</text>
      <g v-for="(lane, i) in lanes" :key="'d' + lane.n">
        <template v-if="lane.sql">
          <line class="res-line" x1="773" :y1="laneY[i]" x2="805" :y2="laneY[i]" />
          <polygon class="res-head" :points="`813,${laneY[i]} 805,${laneY[i] - 4} 805,${laneY[i] + 4}`" />
          <text class="tiny" x="791" :y="laneY[i] - 6" text-anchor="middle">SQL</text>
        </template>
      </g>

      <!-- The wire: a request and a response per lane -->
      <g v-for="(lane, i) in lanes" :key="'w' + lane.n">
        <text class="wire-label" x="414" :y="laneY[i] - 18" text-anchor="middle">
          <tspan class="lane-name">{{ lane.n }} · {{ lane.name }}</tspan>
          <tspan class="mono" dx="10">{{ lane.request }}</tspan>
        </text>
        <line class="req-line" :x1="wireFrom + 4" :y1="laneY[i] - 10" :x2="wireTo - 8" :y2="laneY[i] - 10" />
        <polygon class="req-head" :points="`${wireTo},${laneY[i] - 10} ${wireTo - 9},${laneY[i] - 15} ${wireTo - 9},${laneY[i] - 5}`" />
        <line class="res-line" :x1="wireTo - 4" :y1="laneY[i] + 10" :x2="wireFrom + 8" :y2="laneY[i] + 10" />
        <polygon class="res-head" :points="`${wireFrom},${laneY[i] + 10} ${wireFrom + 9},${laneY[i] + 5} ${wireFrom + 9},${laneY[i] + 15}`" />
        <text class="sub" x="414" :y="laneY[i] + 28" text-anchor="middle">{{ lane.response }}</text>
      </g>
    </svg>

    <!-- Stacked, for narrow screens -->
    <svg class="cs-narrow" viewBox="0 0 340 312" role="img"
         aria-labelledby="cs-narrow-title cs-narrow-desc">
      <title id="cs-narrow-title">How a Breeze client talks to a Breeze .NET server</title>
      <desc id="cs-narrow-desc">
        Three exchanges over HTTP and JSON: metadata, query and save. Each request goes from the
        browser to the server, and its response comes back.
      </desc>
      <text class="zone-label" x="52" y="14" text-anchor="middle">Browser</text>
      <text class="zone-label" x="288" y="14" text-anchor="middle">Server</text>
      <g v-for="(lane, i) in lanes" :key="'m' + lane.n">
        <text class="lane-name" x="170" :y="cardTop(i) + 8" text-anchor="middle">{{ lane.n }} · {{ lane.name }}</text>
        <rect class="row client" x="1" :y="cardTop(i) + 18" width="102" height="48" rx="7" />
        <text class="title small" x="52" :y="cardTop(i) + 46" text-anchor="middle">{{ lane.short.client }}</text>
        <rect class="row" x="237" :y="cardTop(i) + 18" width="102" height="48" rx="7" />
        <text class="title small" :class="{ mono: lane.short.serverIsCode }" x="288" :y="cardTop(i) + 46" text-anchor="middle">{{ lane.short.server }}</text>
        <text class="tiny mono" x="170" :y="cardTop(i) + 28" text-anchor="middle">{{ lane.short.request }}</text>
        <line class="req-line" x1="107" :y1="cardTop(i) + 35" x2="227" :y2="cardTop(i) + 35" />
        <polygon class="req-head" :points="`235,${cardTop(i) + 35} 227,${cardTop(i) + 31} 227,${cardTop(i) + 39}`" />
        <line class="res-line" x1="233" :y1="cardTop(i) + 51" x2="113" :y2="cardTop(i) + 51" />
        <polygon class="res-head" :points="`105,${cardTop(i) + 51} 113,${cardTop(i) + 47} 113,${cardTop(i) + 55}`" />
        <text class="tiny" x="170" :y="cardTop(i) + 64" text-anchor="middle">{{ lane.short.response }}</text>
      </g>
    </svg>

    <figcaption>
      All three are plain HTTP and JSON, and the server keeps nothing between them: the cache and
      the pending changes live in the client.
    </figcaption>
  </figure>
</template>

<style scoped>
.cs-diagram {
  margin: 24px 0 8px;
}
.cs-diagram svg {
  display: block;
  width: 100%;
  height: auto;
  font-family: var(--vp-font-family-base);
}
.cs-narrow {
  display: none !important;
  max-width: 420px;
  margin: 0 auto;
}
@media (max-width: 640px) {
  .cs-wide { display: none !important; }
  .cs-narrow { display: block !important; }
}
.cs-diagram figcaption {
  margin-top: 12px;
  font-size: 14px;
  color: var(--vp-c-text-2);
  text-align: center;
}

.zone { fill: var(--vp-c-bg-soft); stroke: var(--vp-c-divider); }
.zone-label { fill: var(--vp-c-text-2); font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
.app { fill: var(--vp-c-bg); stroke: var(--vp-c-divider); }
.lib { fill: var(--vp-c-brand-soft); stroke: var(--vp-c-brand-1); stroke-opacity: 0.5; }
.lib-label { fill: var(--vp-c-brand-1); font-size: 12.5px; font-weight: 600; }
.row { fill: var(--vp-c-bg); stroke: var(--vp-c-divider); }
.row.client { fill: var(--vp-c-brand-soft); }
.db { fill: var(--vp-c-bg); stroke: var(--vp-c-text-3); }

.title { fill: var(--vp-c-text-1); font-size: 13.5px; font-weight: 600; }
.title.small { font-size: 11.5px; }
.sub { fill: var(--vp-c-text-2); font-size: 11.5px; }
.sub.strong { fill: var(--vp-c-text-1); font-weight: 600; }
.tiny { fill: var(--vp-c-text-2); font-size: 10.5px; }
.mono { font-family: var(--vp-font-family-mono); }
.title.mono { font-size: 12.5px; }
.title.small.mono { font-size: 11px; }

.wire-label { fill: var(--vp-c-text-1); font-size: 12.5px; }
.wire-label .mono { fill: var(--vp-c-text-2); font-size: 12px; }
.lane-name { fill: var(--vp-c-brand-1); font-size: 12.5px; font-weight: 700; }

.req-line { stroke: var(--vp-c-brand-1); stroke-width: 2; }
.req-head { fill: var(--vp-c-brand-1); }
.res-line { stroke: var(--vp-c-text-3); stroke-width: 2; }
.res-head { fill: var(--vp-c-text-3); }
</style>
