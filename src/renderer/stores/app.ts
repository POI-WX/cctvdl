import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useAppStore = defineStore('app', () => {
  const activeTab = ref('home')
  const sidebarExpanded = ref(localStorage.getItem('cctvdl-sidebar-expanded') === 'true')
  const aboutOpen = ref(false)
  const isDragging = ref(false)
  const statusMessage = ref('')
  const statusType = ref<'success' | 'error' | ''>('')

  function toggleSidebar() {
    sidebarExpanded.value = !sidebarExpanded.value
    localStorage.setItem('cctvdl-sidebar-expanded', String(sidebarExpanded.value))
  }

  return { activeTab, sidebarExpanded, aboutOpen, isDragging, statusMessage, statusType, toggleSidebar }
})
