type ValueModification = {
    value: number;            // The value to use for modification
    modify: (baseValue: number) => number; // Function to apply the modification
};