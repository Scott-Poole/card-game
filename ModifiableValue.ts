type ModifiableValue = {
    baseValue: number;
    currentValue: number;
    modifiers: ValueModification[];
    getValue: () => number; // Function to apply the modification
};
