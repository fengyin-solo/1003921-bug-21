<template>
  <section class="page" data-module="hazard-detail">
    <header class="page-head">
      <div>
        <h2>隐患点详情</h2>
        <p class="page-desc">详情与列表读取同一份状态，核销结论以这里的流转状态为准，历史已核销记录保持原结论不变。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/hazard">返回台账列表</RouterLink>
      </div>
    </header>

    <div v-if="!row" class="empty-state">没有找到该隐患点，可能已被重置或编号有误。</div>

    <template v-else>
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">当前流转状态</span>
          <strong class="stat-value">
            <span class="status-tag" :class="{ terminal: !row.pending }">{{ row.status }}</span>
          </strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">是否有待办</span>
          <strong class="stat-value">{{ row.pending ? '待办中' : '已闭环' }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">下一步动作</span>
          <strong class="stat-value next-action">{{ nextAction || '无（终态）' }}</strong>
        </article>
      </div>

      <table class="data-table detail-table">
        <tbody>
          <tr v-for="column in columns" :key="column">
            <th>{{ column }}</th>
            <td>{{ row[column] ?? '—' }}</td>
          </tr>
        </tbody>
      </table>

      <div class="detail-actions">
        <button
          v-for="action in availableActions"
          :key="action"
          class="btn primary"
          type="button"
          @click="runAction(action)"
        >
          {{ action }}
        </button>
        <span v-if="!availableActions.length" class="muted-text">
          隐患点已处于终态「{{ row.status }}」，不允许再执行治理或核销。
        </span>
      </div>

      <section class="related-block">
        <h3>关联巡查待办</h3>
        <p class="page-desc">核销 / 治理提交时，关联的「待巡查」记录会在同一事务内闭环，失败整体回滚。</p>
        <table class="data-table">
          <thead>
            <tr><th>巡查编号</th><th>巡查日期</th><th>巡查人员</th><th>巡查状态</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in relatedPatrols" :key="String(item.id)">
              <td>{{ item['巡查编号'] ?? '—' }}</td>
              <td>{{ item['巡查日期'] ?? '—' }}</td>
              <td>{{ item['巡查人员'] ?? '—' }}</td>
              <td>{{ item.status }}</td>
            </tr>
            <tr v-if="!relatedPatrols.length">
              <td colspan="4" class="empty-state">暂无关联巡查记录</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <footer class="page-foot">
      <span v-if="successMessage" class="success-text">{{ successMessage }}</span>
      <span v-else-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import { listEntries, moduleMeta, runAction as applyAction } from '@/api/local-service'
import { checkTransition, terminalStatus } from '@/data/state-machine'
import type { EntryRow } from '@/data/types'

const route = useRoute()
const meta = moduleMeta('hazard')
const columns = ["隐患点编号", "隐患点名称", "灾害类型", "所在乡镇", "经纬度坐标", "威胁户数", "威胁人口", "隐患状态"]
const allActions = ["纳入监测", "启动治理", "申请核销"]

const row = ref<EntryRow | null>(null)
const patrolRows = ref<EntryRow[]>([])
const errorMessage = ref('')
const successMessage = ref('')

const terminal = terminalStatus(meta)
const availableActions = computed(() => {
  if (!row.value || String(row.value.status) === terminal) {
    return []
  }
  return allActions.filter((action) => checkTransition(meta, row.value!.status, action).ok)
})
const nextAction = computed(() => availableActions.value[0] ?? '')

const relatedPatrols = computed(() => {
  const code = row.value ? String(row.value['隐患点编号'] ?? '').trim() : ''
  if (!code) {
    return []
  }
  return patrolRows.value.filter((item) => String(item['隐患点编号'] ?? '').trim() === code)
})

function reload() {
  errorMessage.value = ''
  try {
    const id = Number(route.params.id)
    row.value = listEntries(meta.key).items.find((item) => Number(item.id) === id) ?? null
    patrolRows.value = listEntries('patrol').items
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '隐患点详情读取失败'
  }
}

async function runAction(action: string) {
  if (!row.value) {
    return
  }
  errorMessage.value = ''
  successMessage.value = ''
  const result = await applyAction(meta.key, Number(row.value.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  successMessage.value = result.message
  reload()
}

onMounted(reload)
</script>
