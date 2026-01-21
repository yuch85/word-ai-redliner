/* global Office */

Office.onReady(() => {
    // If needed, setup command handlers here
});

function action(event) {
    // Your code goes here
    event.completed();
}

// Register the function
Office.actions.associate("action", action);
