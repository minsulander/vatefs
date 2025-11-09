import { defineStore } from "pinia"
import { ref } from "vue"

export const useEfsStore = defineStore("efs", () => {

    let socket: WebSocket | undefined = undefined

    const connected = ref(false)

    function connect() {
        if (connected.value && socket?.readyState == WebSocket.OPEN) return
        socket = new WebSocket(`ws://${location.hostname}:17770`)
        ;(window as any).socket = socket
        if (socket.readyState == WebSocket.OPEN) {
            console.log("socket open at mounted")
            socket.send("?")
            connected.value = true
        }
        socket.onopen = () => {
            console.log("socket opened")
            if (socket) socket.send("?")
            connected.value = true
        }
        socket.onclose = () => {
            console.log("socket closed")
            connected.value = false
        }
        socket.onmessage = (message: WebSocketMessage) => {
            const data = JSON.parse(message.data)
            console.log("received", data)
        }
    }

    // init

    connect()
    setInterval(() => {
        if (!connected.value) connect()
    }, 3000)

    return {
    }
})
