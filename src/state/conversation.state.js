const conversations = new Map();

function getConversation(phoneNumber) {
    return conversations.get(phoneNumber);
}

function createConversation(phoneNumber) {
    const conversation = {
        phoneNumber,
        currentStep: "START",
        data: {}
    };

    conversations.set(phoneNumber, conversation);

    return conversation;
}

function getOrCreateConversation(phoneNumber) {
    return (
        getConversation(phoneNumber) ||
        createConversation(phoneNumber)
    );
}

function updateConversation(phoneNumber, updates) {
    const conversation = getConversation(phoneNumber);

    if (!conversation) {
        throw new Error(`Conversation not found: ${phoneNumber}`);
    }

    Object.assign(conversation, updates);

    conversations.set(phoneNumber, conversation);

    return conversation;
}

module.exports = {
    getConversation,
    createConversation,
    getOrCreateConversation,
    updateConversation
};