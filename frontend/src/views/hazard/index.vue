<template>
  <section class="page" data-module="hazard">
    <header class="page-head">
      <div>
        <h2>隐患点台账管理</h2>
        <p class="page-desc">维护隐患点，围绕隐患点编号、隐患点名称、灾害类型、所在乡镇做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记隐患点</button>
        <button class="btn" type="button" @click="exportRows">导出隐患点台账清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <RouterLink v-if="column === '隐患点编号'" class="link" :to="`/hazard/${row.id}`">
              {{ row[column] ?? '—' }}
            </RouterLink>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>
            <span class="status-tag" :class="{ terminal: !row.pending }">{{ row.status }}</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in availableActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <span v-if="!availableActions(row).length" class="muted-text">已到终态，无待办动作</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无隐患点台账数据，可先登记隐患点</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条隐患点台账记录</span>
      <span v-if="successMessage" class="success-text">{{ successMessage }}</span>
      <span v-else-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { checkTransition, terminalStatus } from '@/data/state-machine'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('hazard')
const columns = ["隐患点编号", "隐患点名称", "灾害类型", "所在乡镇", "经纬度坐标", "威胁户数", "威胁人口", "隐患状态"]
const actions = ["纳入监测", "启动治理", "申请核销"]
const statuses = ["在册", "监测中", "已治理", "已核销"]
const stats = computed(() => [
  { label: "隐患点总数", value: rows.value.length },
  { label: "监测中数量", value: rows.value.filter((row) => String(row.status) === "监测中").length },
  { label: "已治理数量", value: rows.value.filter((row) => String(row.status) === "已治理").length },
])

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const successMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const terminal = terminalStatus(meta)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 只给出当前状态下合法的下一步动作：已核销等终态不再出现任何动作按钮，
// 从 UI 侧就避免「治理 / 核销」并发入口并存。
function availableActions(row: EntryRow): string[] {
  if (String(row.status) === terminal) {
    return []
  }
  return actions.filter((action) => checkTransition(meta, row.status, action).ok)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '隐患点登记入口尚未接入审批流'
}

async function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  successMessage.value = ''
  const result = await applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  successMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '隐患点台账列表读取失败'
  }
}

onMounted(reload)
</script>
