const ACTIONS = {
  BACK: "BACK",
  SKIP: "SKIP",
  CHECK_IN: "CHECK_IN",
  NEW_CUSTOMER_VISIT: "NEW_CUSTOMER_VISIT",
  MAIN_MENU: "MAIN_MENU",
  CANCEL: "CANCEL",
};

function withStateHistory(conversation, nextState) {
  const history = Array.isArray(conversation.history) ? [...conversation.history] : [];
  if (conversation.currentState && conversation.currentState !== nextState && history[history.length - 1] !== conversation.currentState) {
    history.push(conversation.currentState);
  }
  if (history.length > 12) history.shift();
  return history;
}

function handleTransition(conversation, action = {}) {
  const normalizedAction = action && action.action ? action.action : "";

  if (normalizedAction === ACTIONS.BACK) {
    const history = Array.isArray(conversation.history) ? [...conversation.history] : [];
    const previousState = history.pop() || "MAIN_MENU";
    conversation.history = history;
    conversation.currentState = previousState;
    conversation.stateVersion += 1;
    return {
      nextState: previousState,
      messages: [{ type: "TEXT", text: "Returning to the previous step." }],
    };
  }

  if (normalizedAction === ACTIONS.CANCEL) {
    conversation.currentState = "MAIN_MENU";
    conversation.stateVersion += 1;
    return {
      nextState: "MAIN_MENU",
      messages: [{ type: "TEXT", text: "The current draft was cancelled." }],
    };
  }

  switch (conversation.currentState) {
    case "START":
      conversation.history = withStateHistory(conversation, "MAIN_MENU");
      conversation.currentState = "MAIN_MENU";
      conversation.stateVersion += 1;
      return {
        nextState: "MAIN_MENU",
        messages: [{ type: "LIST", title: "What would you like to do?", items: [
          { id: ACTIONS.CHECK_IN, label: "Check in" },
          { id: ACTIONS.NEW_CUSTOMER_VISIT, label: "New customer visit" },
        ] }],
      };

    case "MAIN_MENU": {
      if (normalizedAction === ACTIONS.CHECK_IN) {
        conversation.history = withStateHistory(conversation, "CHECK_IN");
        conversation.currentState = "CHECK_IN";
        conversation.stateVersion += 1;
        return {
          nextState: "CHECK_IN",
          messages: [{ type: "CARD", title: "Check in", body: "Share your current location to record your field visit.", ctaLabel: "Share location" }],
        };
      }

      if (normalizedAction === ACTIONS.NEW_CUSTOMER_VISIT) {
        conversation.history = withStateHistory(conversation, "NEW_VISIT_COMPANY");
        conversation.currentState = "NEW_VISIT_COMPANY";
        conversation.stateVersion += 1;
        return {
          nextState: "NEW_VISIT_COMPANY",
          messages: [{ type: "TEXT", text: "What is the customer company name?" }],
        };
      }

      return {
        nextState: "MAIN_MENU",
        messages: [{ type: "TEXT", text: "Please select one of the available options." }],
      };
    }

    case "NEW_VISIT_COMPANY": {
      const companyName = action && action.text ? String(action.text).trim() : "";
      if (!companyName) {
        return { nextState: "NEW_VISIT_COMPANY", messages: [{ type: "TEXT", text: "Please enter the company name." }] };
      }
      conversation.data.companyName = companyName;
      conversation.history = withStateHistory(conversation, "NEW_VISIT_CONTACT");
      conversation.currentState = "NEW_VISIT_CONTACT";
      conversation.stateVersion += 1;
      return {
        nextState: "NEW_VISIT_CONTACT",
        messages: [{ type: "TEXT", text: "Who did you meet? Type their name." }],
      };
    }

    case "NEW_VISIT_CONTACT": {
      const contactName = action && action.text ? String(action.text).trim() : "";
      if (!contactName) {
        return { nextState: "NEW_VISIT_CONTACT", messages: [{ type: "TEXT", text: "Please enter the contact name." }] };
      }
      conversation.data.contactName = contactName;
      conversation.history = withStateHistory(conversation, "NEW_VISIT_PHONE");
      conversation.currentState = "NEW_VISIT_PHONE";
      conversation.stateVersion += 1;
      return {
        nextState: "NEW_VISIT_PHONE",
        messages: [{ type: "TEXT", text: "What is their mobile number?" }],
      };
    }

    case "NEW_VISIT_PHONE": {
      if (normalizedAction === ACTIONS.SKIP) {
        conversation.data.contactMobile = null;
        conversation.history = withStateHistory(conversation, "NEW_VISIT_LOCATION");
        conversation.currentState = "NEW_VISIT_LOCATION";
        conversation.stateVersion += 1;
        return {
          nextState: "NEW_VISIT_LOCATION",
          messages: [{ type: "CARD", title: "Visit location", body: "Share your location to start the visit.", ctaLabel: "Share location" }],
        };
      }

      const contactMobile = action && action.text ? String(action.text).trim() : "";
      if (!contactMobile) {
        return { nextState: "NEW_VISIT_PHONE", messages: [{ type: "TEXT", text: "Please provide a valid mobile number or choose Skip." }] };
      }

      conversation.data.contactMobile = contactMobile;
      conversation.history = withStateHistory(conversation, "NEW_VISIT_LOCATION");
      conversation.currentState = "NEW_VISIT_LOCATION";
      conversation.stateVersion += 1;
      return {
        nextState: "NEW_VISIT_LOCATION",
        messages: [{ type: "CARD", title: "Visit location", body: "Share your location to start the visit.", ctaLabel: "Share location" }],
      };
    }

    default:
      return {
        nextState: conversation.currentState,
        messages: [{ type: "TEXT", text: "Please select one of the available options." }],
      };
  }
}

module.exports = {
  ACTIONS,
  handleTransition,
};
